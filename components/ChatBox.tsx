"use client";
import { useState, useEffect } from "react";
import MathText from "@/components/MathText";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface StepResponse {
  type: "step" | "text" | "complete";
  step?: number;
  totalSteps?: number;
  question?: string;
  options?: string[];
  content?: string;
}

interface ChatBoxProps {
  questionData?: {
    question_text: string;
    answer: string;
    explanation: string | null;
    type: string;
    choices?: string[] | null;
  };
}

export default function ChatBox({ questionData }: ChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepResponse | null>(null);
  const [lastStepBeforeQuestion, setLastStepBeforeQuestion] =
    useState<StepResponse | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const extractJsonStrings = (message: string): string[] => {
    // 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
    const cleanMessage = message
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```/g, "");

    const results: string[] = [];
    let braceCount = 0;
    let startIndex = -1;

    for (let i = 0; i < cleanMessage.length; i++) {
      const ch = cleanMessage[i];
      if (ch === "{") {
        if (braceCount === 0) startIndex = i;
        braceCount++;
      } else if (ch === "}") {
        if (braceCount > 0) braceCount--;
        if (braceCount === 0 && startIndex !== -1) {
          results.push(cleanMessage.substring(startIndex, i + 1));
          startIndex = -1;
        }
      }
    }

    return results;
  };

  const parseJsonResponses = (message: string): StepResponse[] => {
    const jsonStrings = extractJsonStrings(message);
    const parsed: StepResponse[] = [];
    for (const js of jsonStrings) {
      try {
        parsed.push(JSON.parse(js));
      } catch {
        // ignore invalid json chunks
      }
    }
    return parsed;
  };

  const applyParsedResponsesToState = (parsedResponses: StepResponse[]) => {
    if (!parsedResponses.length) {
      setCurrentStep(null);
      return;
    }

    // step은 "현재 단계"로 저장해두기 (임의 질문 이후 복원용)
    for (const r of parsedResponses) {
      if (r?.type === "step") {
        setLastStepBeforeQuestion(r);
      }
    }

    const complete = parsedResponses.find((r) => r?.type === "complete");
    if (complete) {
      setIsCompleted(true);
      setCurrentStep(complete);
      return;
    }

    const lastStep = [...parsedResponses]
      .reverse()
      .find((r) => r?.type === "step");
    if (lastStep) {
      setIsCompleted(false);
      setCurrentStep(lastStep);
      return;
    }

    const lastText = [...parsedResponses]
      .reverse()
      .find((r) => r?.type === "text");
    if (lastText) {
      setCurrentStep(lastText);
      return;
    }

    setCurrentStep(null);
  };

  // 문제가 변경되면 초기화 및 자동 시작
  useEffect(() => {
    if (questionData) {
      console.log("Question changed, initializing...");
      const systemPrompt = createSystemPrompt(questionData);
      const initialMessages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: "문제 풀이를 시작해줘" },
      ];
      setMessages(initialMessages);
      setCurrentStep(null);
      setIsCompleted(false);
      setInput("");
      // 자동으로 첫 단계 요청
      startTutoring(initialMessages);
    }
  }, [questionData?.question_text]);

  const createSystemPrompt = (data: ChatBoxProps["questionData"]) => {
    if (!data) return "";

    const choicesText =
      data.choices && data.type === "multiple_choice"
        ? "\n선지:\n" + data.choices.map((c, i) => i + 1 + ". " + c).join("\n")
        : "";

    const prompt =
      "당신은 학생의 수학 문제 풀이를 단계별로 안내하는 AI 튜터입니다.\n\n" +
      "현재 문제:\n" +
      data.question_text +
      "\n\n" +
      "문제 유형: " +
      (data.type === "multiple_choice" ? "객관식" : "단답형") +
      choicesText +
      "\n\n" +
      "정답: " +
      data.answer +
      "\n" +
      "해설: " +
      data.explanation +
      "\n\n" +
      "핵심 요구사항(반드시 지켜라):\n" +
      "1) 전체 단계는 반드시 3~4단계로만 구성한다. (totalSteps는 3 또는 4)\n" +
      "2) 각 단계는 학생이 선택지를 고르는 방식으로 진행한다. options는 3~5개.\n" +
      "3) 학생이 선택지를 고르면 피드백을 주고 다음 단계로 진행한다.\n" +
      "4) 학생의 선택이 '오답'이면: 왜 틀렸는지 수식/계산을 포함해 상세 피드백을 주고, 같은 단계(step 동일)에서 다시 선택하게 한다.\n" +
      "5) 같은 단계에서 학생이 '오답'을 두 번 하면: 두 번째 오답에도 상세 피드백을 주되, 그 다음에는 그냥 다음 단계(step+1)로 진행한다.\n" +
      "   - 너는 대화 히스토리를 보고, 같은 step 번호에서 오답 피드백이 1번 있었는지/2번째인지 스스로 판단해야 한다.\n" +
      "6) 임의 질문(선택지와 무관한 질문)이 들어오면: 먼저 type=text로 답변하고, 이어서 현재 진행 중인 단계를 type=step으로 다시 제시한다.\n" +
      "7) 문제가 완료(type=complete)된 이후에는: 임의 질문에는 type=text로만 답변하고, step을 다시 제시하지 않는다.\n\n" +
      "엄격 규칙:\n" +
      "- 모든 응답은 JSON만 반환한다. (JSON 이외의 텍스트 금지)\n" +
      "- 임의 질문에 대한 응답만 예외적으로 JSON을 2개 연속으로 반환할 수 있다: 먼저 {type:text...} 다음 {type:step...}\n" +
      "- 수학 수식/LaTeX는 반드시 $...$ (인라인) 또는 $$...$$ (블록)으로 감싸서 작성한다. (예: $x^2+1=0$, $\\frac{1}{2}$)\n" +
      '- 줄바꿈이 필요하면 실제 줄바꿈을 사용하고, 문자열 "\\\\n" 또는 "\\\\n\\\\n"를 그대로 출력하지 마라.\n' +
      "- options는 반드시 구체적인 수식/계산을 포함해야 한다. (예: '식을 정리한다' 금지)\n" +
      '- options의 마지막은 항상 "이 단계 건너뛰기"를 포함한다.\n' +
      "- totalSteps 값은 시작 시 결정하고 끝까지 유지한다.\n\n" +
      "JSON 스키마:\n" +
      '- 단계: {"type":"step","step":1,"totalSteps":3,"question":"...","options":["...",...]} \n' +
      '- 텍스트: {"type":"text","content":"..."}\n' +
      '- 완료: {"type":"complete","content":"..."}\n\n' +
      "시작 조건:\n" +
      '- 사용자가 "문제 풀이를 시작해줘"라고 하면 step=1을 제시한다.\n';

    return prompt;
  };

  const startTutoring = async (initialMessages: Message[]) => {
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: initialMessages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const assistantMessage = data.message;
      console.log("AI Response:", assistantMessage);

      const parsedResponses = parseJsonResponses(assistantMessage);
      const jsonStrings = extractJsonStrings(assistantMessage);

      const assistantMessages: Message[] =
        jsonStrings.length > 0
          ? jsonStrings.map((js) => ({
              role: "assistant" as const,
              content: js,
            }))
          : [{ role: "assistant" as const, content: assistantMessage }];

      const updatedMessages = [...initialMessages, ...assistantMessages];
      setMessages(updatedMessages);

      applyParsedResponsesToState(parsedResponses);
    } catch (error: any) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `오류: ${
            error.message || "알 수 없는 오류가 발생했습니다."
          }`,
        },
      ]);
    }
    setLoading(false);
  };

  const sendMessage = async (userMessage: string) => {
    if (!questionData || !userMessage.trim()) return;

    const newMessages = [
      ...messages,
      { role: "user" as const, content: userMessage },
    ];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setCurrentStep(null); // 버튼 숨김

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const assistantMessage = data.message;
      console.log("AI Response:", assistantMessage);

      const parsedResponses = parseJsonResponses(assistantMessage);
      const jsonStrings = extractJsonStrings(assistantMessage);

      const assistantMessages: Message[] =
        jsonStrings.length > 0
          ? jsonStrings.map((js) => ({
              role: "assistant" as const,
              content: js,
            }))
          : [{ role: "assistant" as const, content: assistantMessage }];

      const updatedMessages = [...newMessages, ...assistantMessages];
      setMessages(updatedMessages);

      applyParsedResponsesToState(parsedResponses);

      // 모델이 text만 보내고 step을 안 보내는 경우를 대비해, 즉시(다음 tick) 이전 단계를 복원
      const hasStep = parsedResponses.some((r) => r?.type === "step");
      const hasText = parsedResponses.some((r) => r?.type === "text");
      // 단, 문제 풀이가 완료된 이후에는 마지막 step을 다시 노출하지 않는다.
      if (
        !isCompleted &&
        !hasStep &&
        hasText &&
        lastStepBeforeQuestion?.type === "step"
      ) {
        setTimeout(() => {
          setCurrentStep(lastStepBeforeQuestion);
        }, 0);
      }
    } catch (error: any) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `오류: ${
            error.message || "알 수 없는 오류가 발생했습니다."
          }`,
        },
      ]);
    }
    setLoading(false);
  };

  const handleOptionClick = (option: string) => {
    sendMessage(option);
  };

  if (!questionData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 p-4 text-center">
        <div>
          <p className="text-lg mb-2">AI 튜터</p>
          <p className="text-sm">문제를 선택하면 단계별로 도와드립니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-4 flex-shrink-0">
        <h2 className="text-lg font-bold">AI 튜터</h2>
        <p className="text-sm opacity-90">단계별로 문제를 풀어봅시다</p>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 min-h-0">
        {messages
          .filter((msg) => msg.role !== "system")
          .map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="bg-blue-500 text-white px-4 py-2 rounded-lg max-w-[80%] break-words">
                    <MathText text={msg.content} />
                  </div>
                </div>
              );
            } else {
              // assistant 메시지 처리
              // JSON에서 content 추출 시도
              try {
                const jsonMatch = msg.content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]);

                  // type: "text" 또는 "complete"인 경우 content 표시
                  if (parsed.type === "text" && parsed.content) {
                    return (
                      <div key={i} className="flex justify-start">
                        <div className="bg-white border border-gray-200 px-4 py-2 rounded-lg max-w-[80%] shadow-sm break-words">
                          <MathText text={parsed.content} />
                        </div>
                      </div>
                    );
                  }

                  // type: "step"인 경우 아래 버튼으로 표시되므로 메시지는 숨김
                  if (parsed.type === "step") {
                    return null;
                  }
                }
              } catch (e) {
                // JSON 파싱 실패 시 일반 텍스트로 표시
              }

              // JSON이 아니거나 파싱 실패한 경우
              let textOnly = msg.content
                .replace(/```json[\s\S]*?```/g, "") // ```json ... ``` 블록 제거
                .replace(/```[\s\S]*?```/g, "") // 일반 코드 블록도 제거
                .replace(/\{[\s\S]*\}/g, "") // JSON 객체 제거
                .trim();

              // "```json" 같은 남은 마크다운 구문도 제거
              textOnly = textOnly.replace(/```\w*/g, "").trim();

              if (!textOnly) return null;

              return (
                <div key={i} className="flex justify-start">
                  <div className="bg-white border border-gray-200 px-4 py-2 rounded-lg max-w-[80%] shadow-sm whitespace-pre-wrap break-words">
                    <MathText text={textOnly} />
                  </div>
                </div>
              );
            }
          })}

        {/* 단계별 옵션 버튼 */}
        {currentStep && currentStep.type === "step" && !loading && (
          <div className="bg-purple-50 border-2 border-purple-200 p-4 rounded-lg space-y-3 shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-purple-700">
                📍 단계 {currentStep.step} / {currentStep.totalSteps}
              </span>
            </div>
            <div className="font-medium text-gray-900 text-base">
              <MathText text={currentStep.question || ""} />
            </div>
            <div className="space-y-2 mt-3">
              {currentStep.options?.map((option, idx) => (
                <button
                  key={idx}
                  onClick={() => handleOptionClick(option)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-all font-medium break-words ${
                    option.includes("건너뛰기")
                      ? "bg-gray-200 hover:bg-gray-300 text-gray-700 border border-gray-300"
                      : "bg-white hover:bg-purple-100 border-2 border-purple-300 text-gray-800 hover:border-purple-400 shadow-sm"
                  }`}
                >
                  <MathText text={option} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 완료 메시지 */}
        {currentStep && currentStep.type === "complete" && !loading && (
          <div className="bg-green-50 border-2 border-green-300 p-4 rounded-lg shadow-md">
            <div className="text-green-700 font-bold mb-2">🎉 완료!</div>
            <div className="text-gray-800">
              <MathText text={currentStep.content || ""} />
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-center">
            <div className="bg-gray-200 px-4 py-2 rounded-lg text-gray-600 text-sm">
              답변 생성중...
            </div>
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div className="border-t bg-white p-4 flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === "Enter" && !loading && input.trim()) {
                sendMessage(input);
              }
            }}
            placeholder="궁금한 점을 질문하세요..."
            className="flex-1 border-2 border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="bg-blue-500 text-white px-6 py-2 rounded-lg disabled:bg-gray-300 hover:bg-blue-600 transition-colors font-medium"
          >
            전송
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          💡 단계를 따라가거나, 언제든 질문할 수 있어요
        </p>
      </div>
    </div>
  );
}
