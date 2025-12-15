import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

export async function POST(req: Request) {
  try {
    const { pdfUrl, pdfId } = await req.json();

    if (!pdfUrl || !pdfId) {
      return NextResponse.json(
        { error: "pdfUrl과 pdfId가 필요합니다." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    console.log("📄 PDF 임베딩 시작:", pdfId);

    // 1. PDF 다운로드
    console.log("⬇️ PDF 다운로드 중...");
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error(`PDF 다운로드 실패: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();

    // 2. PDF 텍스트 추출 (동적 import)
    console.log("📖 PDF 텍스트 추출 중...");
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(Buffer.from(buffer));
    const text = data.text;

    if (!text || text.trim().length === 0) {
      throw new Error("PDF에서 텍스트를 추출할 수 없습니다.");
    }

    console.log(`✅ 텍스트 추출 완료: ${text.length}자`);

    // 3. 텍스트 청킹
    console.log("✂️ 텍스트 청킹 중...");
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const chunks = await splitter.createDocuments([text]);
    console.log(`✅ 청킹 완료: ${chunks.length}개 청크`);

    // 4. 임베딩 생성 (병렬 처리)
    console.log("🔢 임베딩 생성 중...");
    const embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
    });

    // 모든 청크의 임베딩을 병렬로 생성
    const embeddingPromises = chunks.map(async (chunk, i) => {
      const embedding = await embeddings.embedQuery(chunk.pageContent);
      return {
        pdf_id: pdfId,
        chunk_index: i,
        content: chunk.pageContent,
        embedding: embedding, // vector 타입으로 직접 저장
      };
    });

    const embeddedChunks = await Promise.all(embeddingPromises);

    console.log(`✅ 임베딩 생성 완료: ${embeddedChunks.length}개`);

    // 5. Supabase에 배치로 저장 (한번에 너무 많으면 네트워크 에러)
    console.log("💾 Supabase에 저장 중...");
    const BATCH_SIZE = 20; // 한번에 20개씩 저장

    for (let i = 0; i < embeddedChunks.length; i += BATCH_SIZE) {
      const batch = embeddedChunks.slice(i, i + BATCH_SIZE);
      console.log(
        `💾 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          embeddedChunks.length / BATCH_SIZE
        )} 저장 중... (${batch.length}개)`
      );

      const { error: insertError } = await supabase
        .from("pdf_embeddings")
        .insert(batch);

      if (insertError) {
        console.error("❌ 임베딩 저장 실패:", insertError);
        throw new Error(`임베딩 저장 실패: ${insertError.message}`);
      }
    }

    console.log("✅ 임베딩 저장 완료");

    // 6. PDF 상태 업데이트
    const { error: updateError } = await supabase
      .from("pdfs")
      .update({
        rag_status: "completed",
      })
      .eq("id", pdfId);

    if (updateError) {
      console.error("❌ PDF 상태 업데이트 실패:", updateError);
      throw new Error(`PDF 상태 업데이트 실패: ${updateError.message}`);
    }

    console.log("✅ PDF 임베딩 완료:", pdfId);

    return NextResponse.json({
      success: true,
      chunksCount: chunks.length,
      message: "PDF 임베딩이 완료되었습니다.",
    });
  } catch (error: any) {
    console.error("❌ PDF 임베딩 에러:", error);
    return NextResponse.json(
      {
        error: error.message || "PDF 임베딩 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}



