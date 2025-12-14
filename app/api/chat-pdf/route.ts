import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import OpenAI from "openai";

type SimilarChunk = {
  pdf_id: string;
  chunk_index: number;
  similarity: number;
  content: string;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages, folderId, useGptKnowledge = false } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages가 필요합니다." },
        { status: 400 }
      );
    }

    if (!folderId) {
      return NextResponse.json(
        { error: "folderId가 필요합니다." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    const userQuestion = messages[messages.length - 1].content;
    console.log("📝 PDF 채팅 질문:", userQuestion);
    console.log("📁 폴더 ID:", folderId);
    console.log("🧠 ChatGPT 지식 사용:", useGptKnowledge);

    // 1. 해당 폴더의 PDF ID들 가져오기
    const { data: pdfs, error: pdfsError } = await supabase
      .from("pdfs")
      .select("id, filename, rag_status")
      .eq("folder_id", folderId);

    if (pdfsError) {
      console.error("❌ PDF 조회 실패:", pdfsError);
      throw new Error(`PDF 조회 실패: ${pdfsError.message}`);
    }

    const pdfIds = pdfs?.map((p) => p.id) || [];
    const completedPdfs =
      pdfs?.filter((p) => p.rag_status === "completed") || [];

    console.log(
      `📄 총 PDF: ${pdfIds.length}개, 완료된 PDF: ${completedPdfs.length}개`
    );

    if (pdfIds.length === 0) {
      return NextResponse.json({
        message: "이 폴더에 업로드된 PDF가 없습니다.",
      });
    }

    if (completedPdfs.length === 0) {
      return NextResponse.json({
        message:
          "이 폴더에 임베딩이 완료된 PDF가 없습니다. PDF 업로드 후 임베딩이 완료될 때까지 기다려주세요.",
      });
    }

    // 2. 질문을 벡터로 변환
    console.log("🔢 질문 임베딩 생성 중...");
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });
    const questionEmbedding = await embeddings.embedQuery(userQuestion);
    console.log("✅ 질문 임베딩 완료");

    // 3. pgvector로 유사한 청크 검색
    console.log("🔍 유사 청크 검색 중...");
    const { data: similarChunksRaw, error: searchError } = await supabase.rpc(
      "match_pdf_chunks",
      {
        query_embedding: questionEmbedding,
        match_count: 5,
        pdf_ids: pdfIds,
      }
    );
    const similarChunks = (similarChunksRaw as SimilarChunk[] | null) ?? null;

    if (searchError) {
      console.error("❌ 유사 청크 검색 실패:", searchError);
      // pgvector 함수가 없을 경우를 대비한 에러 처리
      if (
        searchError.message.includes("function") ||
        searchError.message.includes("does not exist")
      ) {
        return NextResponse.json(
          {
            error:
              "PDF 검색 기능이 설정되지 않았습니다. Supabase에서 match_pdf_chunks 함수를 생성해주세요.",
          },
          { status: 500 }
        );
      }
      throw new Error(`유사 청크 검색 실패: ${searchError.message}`);
    }

    console.log(`✅ 검색된 청크: ${similarChunks?.length || 0}개`);

    // 4. 유사도 필터링 (임계값 이상만 사용)
    // 너무 낮으면 문서와 무관한 질문(예: 날씨)에도 청크가 잡혀 출처 UI가 오해를 줄 수 있음
    const SIMILARITY_THRESHOLD = 0.82;
    const filteredChunks =
      similarChunks?.filter(
        (chunk) => chunk.similarity >= SIMILARITY_THRESHOLD
      ) || [];

    console.log(
      `🎯 유사도 ${SIMILARITY_THRESHOLD} 이상 청크: ${filteredChunks.length}개`
    );
    if (filteredChunks.length > 0) {
      console.log(
        `📊 유사도 범위: ${Math.max(
          ...filteredChunks.map((c) => c.similarity)
        ).toFixed(3)} ~ ${Math.min(
          ...filteredChunks.map((c) => c.similarity)
        ).toFixed(3)}`
      );
    }

    // 5. 검색된 청크를 컨텍스트로 합치기 + PDF 정보 매핑
    if (!filteredChunks || filteredChunks.length === 0) {
      return NextResponse.json({
        message:
          "질문과 관련된 내용을 찾을 수 없습니다. 다른 질문을 시도해보세요.",
      });
    }

    // PDF ID로 파일명 매핑
    const pdfMap = new Map(pdfs?.map((p) => [p.id, p.filename]) || []);

    // 참고 출처 정보 생성
    const sources = filteredChunks.map((chunk, idx) => ({
      pdfName: pdfMap.get(chunk.pdf_id) || "알 수 없음",
      chunkIndex: chunk.chunk_index,
      similarity: chunk.similarity,
      content: chunk.content.substring(0, 150), // 미리보기용
    }));

    // 고유한 파일명만 추출 (중복 제거)
    const uniquePdfNames = Array.from(new Set(sources.map((s) => s.pdfName)));

    // 컨텍스트 생성 (청크 인덱스 포함)
    const context = filteredChunks
      .map((chunk, idx) => {
        const pdfName = pdfMap.get(chunk.pdf_id) || "알 수 없음";
        return `[출처 ${idx + 1}: ${pdfName} - 청크 ${
          chunk.chunk_index + 1
        }]\n${chunk.content}`;
      })
      .join("\n\n");

    console.log(`📚 컨텍스트 길이: ${context.length}자`);
    console.log(`📎 참고 문서: ${uniquePdfNames.join(", ")}`);

    // 6. GPT에게 컨텍스트 + 질문 전달
    console.log("💬 GPT 응답 생성 중...");

    const systemPrompt = useGptKnowledge
      ? `당신은 PDF 문서를 분석하는 AI 어시스턴트입니다. 다음 문서 내용을 참고하되, 필요시 당신의 일반 지식도 활용하여 질문에 답변해주세요.

답변 작성 규칙:
1. 답변은 한국어로 작성하세요.
2. 주로 제공된 문서 내용을 기반으로 답변하되, 문서에 없는 부분은 일반 지식을 활용하여 보완할 수 있습니다.
3. 문서 내용과 일반 지식을 혼합할 경우, 어느 부분이 문서 기반인지 간단히 구분해 주세요.
4. 참고/출처 문구(예: "참고:", "**참고:**")를 답변 본문에 포함하지 마세요. (출처는 UI에서 별도로 표시됩니다)

참고 문서:
${context}`
      : `당신은 PDF 문서를 분석하는 AI 어시스턴트입니다. 다음 문서 내용을 참고해서 질문에 답변해주세요.

답변 작성 규칙:
1. 답변은 한국어로 작성하세요.
2. 문서에 명시된 내용만을 기반으로 답변하세요.
3. 문서에 없는 내용은 "문서에서 해당 내용을 찾을 수 없습니다"라고 답변하세요.
4. 참고/출처 문구(예: "참고:", "**참고:**")를 답변 본문에 포함하지 마세요. (출처는 UI에서 별도로 표시됩니다)

참고 문서:
${context}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const answer = response.choices[0].message.content;
    console.log("✅ GPT 응답 완료");
    console.log("응답 미리보기:", answer?.substring(0, 100));

    // 모델이 답변에 참고/출처 섹션을 붙이는 경우가 있어, UI에서만 보여주기 위해 제거
    const stripReferences = (text: string) => {
      const lines = text.split(/\r?\n/);
      const idx = lines.findIndex((line) =>
        /^\s*(\*\*\s*)?참고\s*[:：]/.test(line)
      );
      if (idx === -1) return text.trim();
      return lines.slice(0, idx).join("\n").trim();
    };
    const cleanedAnswer = answer ? stripReferences(answer) : "";

    // 모델이 "문서에 없음"으로 결론 내리면 출처를 함께 보여주지 않도록 sources를 비움
    // (검색 결과는 있었더라도 실제로 답변에 활용되지 않았다는 의미이므로 UX상 혼란 방지)
    const notFoundPhrases = [
      "문서에서 해당 내용을 찾을 수 없습니다",
      "질문과 관련된 내용을 찾을 수 없습니다",
      "문서에서 해당 내용을 찾을 수 없",
    ];
    const finalMessage = cleanedAnswer || answer || "";
    const isNotFound = notFoundPhrases.some((p) => finalMessage.includes(p));
    const finalSources = isNotFound ? [] : sources;

    return NextResponse.json({
      message: finalMessage,
      sources: finalSources, // "문서에 없음"이면 빈 배열로 반환
    });
  } catch (error: any) {
    console.error("❌ Chat PDF error:", error);
    return NextResponse.json(
      {
        error: error.message || "PDF 채팅 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

