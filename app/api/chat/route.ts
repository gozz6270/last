import OpenAI from "openai";
import { NextResponse } from "next/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set");
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인하세요.",
        },
        { status: 500 }
      );
    }

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Invalid messages format" },
        { status: 400 }
      );
    }

    console.log("📤 Sending to OpenAI:", messages.length, "messages");

    // JSON 모드 강제 여부 결정 (시스템 메시지가 있으면 문제 풀이 모드)
    const hasSystemMessage = messages.some((m: any) => m.role === "system");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000,
      // 문제 풀이 모드일 때만 JSON 모드 강제
      ...(hasSystemMessage && { response_format: { type: "json_object" } }),
    });

    const content = response.choices[0].message.content;
    console.log("📥 OpenAI response received");
    console.log("Response preview:", content?.substring(0, 100));

    if (!content) {
      throw new Error("OpenAI returned empty response");
    }

    return NextResponse.json({
      message: content,
    });
  } catch (error: any) {
    console.error("❌ Chat API error:", error);

    // OpenAI API 에러 처리
    if (error.code === "insufficient_quota") {
      return NextResponse.json(
        { error: "OpenAI API 할당량이 초과되었습니다." },
        { status: 429 }
      );
    }

    if (error.code === "invalid_api_key") {
      return NextResponse.json(
        { error: "OpenAI API 키가 유효하지 않습니다." },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: error.message || "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

