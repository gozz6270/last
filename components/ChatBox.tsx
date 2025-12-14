"use client";
import { useState, useEffect, useRef } from "react";
import MathText from "@/components/MathText";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  // 화면에는 보이지 않지만, API 전송에만 쓰는 메시지(선택지 번호/현재 단계 등 메타 포함)
  apiContent?: string;
  // UI에 노출하지 않는 내부 메시지(서버 요청용)
  hidden?: boolean;
  sources?: Array<{
    pdfName: string;
    chunkIndex: number;
    similarity: number;
    content: string;
  }>;
}

interface StepResponse {
  type: "step" | "text" | "complete";
  step?: number;
  totalSteps?: number;
  question?: string;
  options?: string[];
  correctIndex?: number; // 정답 선택지의 인덱스 (0-based, 건너뛰기 제외)
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
  apiEndpoint?: string;
  folderId?: string;
  isPdfChat?: boolean;
}

export default function ChatBox({
  questionData,
  apiEndpoint = "/api/chat",
  folderId,
  isPdfChat = false,
}: ChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepResponse | null>(null);
  const [lastStepBeforeQuestion, setLastStepBeforeQuestion] =
    useState<StepResponse | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [useGptKnowledge, setUseGptKnowledge] = useState(false); // ChatGPT 자체 지식 사용 토글
  const [sessionTotalSteps, setSessionTotalSteps] = useState<number | null>(
    null
  );
  const [maxStepSeen, setMaxStepSeen] = useState<number>(0);
  // state는 비동기 업데이트라 totalSteps가 순간적으로 튈 수 있어 ref를 '진짜 기준'으로 사용
  const sessionTotalStepsRef = useRef<number | null>(null);
  const maxStepSeenRef = useRef<number>(0);
  // 선택지 응답에 text 피드백이 빠졌을 때 1회 보정 요청
  const feedbackFixInFlightRef = useRef<boolean>(false);
  const lastFeedbackFixKeyRef = useRef<string>("");
  // 선택지 연타/중복 전송 방지 + 단계 전진 보정
  const optionRequestRef = useRef<{
    step: number;
    isSkip: boolean;
    selectedText: string;
  } | null>(null);
  const advanceFixInFlightRef = useRef<boolean>(false);
  // 각 단계별 오답 횟수 추적 (step → wrongCount)
  const wrongCountPerStepRef = useRef<Map<number, number>>(new Map());

  const normalizeText = (t: string) => t.replace(/\s+/g, " ").trim();

  const looksCorrect = (t?: string) => {
    if (!t) return false;
    // 오답 키워드가 있으면 무조건 false
    if (/틀렸|오답|아쉽|다시\s*선택|다시\s*풀|다시\s*시도/i.test(t))
      return false;
    // 정답 키워드 체크
    return /정답입니다|맞습니다|맞아요|잘\s*하셨습니다|훌륭합니다|완벽합니다|정확합니다|올바른\s*결과/i.test(
      t
    );
  };

  const looksWrong = (t?: string) =>
    !!t && /틀렸|오답|아쉽|다시\s*선택|다시\s*풀|다시\s*시도/i.test(t);

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

  // JSON.parse는 "\t", "\n" 같은 escape를 실제 제어문자로 변환합니다.
  // 모델이 LaTeX를 JSON 안에 "\times" 처럼 (백슬래시 1개) 넣으면 "\t"가 탭으로 변환되어 "imes"가 되는 문제가 생깁니다.
  // 이를 복구하기 위해 "제어문자 + 영문자" 패턴을 다시 "\\t" 같은 문자열로 되돌립니다.
  function reviveLatexEscapes(value: any): any {
    if (typeof value === "string") {
      return value
        .replace(/\t(?=[a-zA-Z])/g, "\\t")
        .replace(/\n(?=[a-zA-Z])/g, "\\n")
        .replace(/\r(?=[a-zA-Z])/g, "\\r")
        .replace(/\f(?=[a-zA-Z])/g, "\\f")
        .replace(/\u0008(?=[a-zA-Z])/g, "\\b");
    }
    if (Array.isArray(value)) return value.map(reviveLatexEscapes);
    if (value && typeof value === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(value))
        out[k] = reviveLatexEscapes(v);
      return out;
    }
    return value;
  }

  const parseJsonResponses = (message: string): StepResponse[] => {
    const jsonStrings = extractJsonStrings(message);
    const parsed: StepResponse[] = [];

    for (const js of jsonStrings) {
      try {
        const obj = reviveLatexEscapes(JSON.parse(js));

        // {"responses": [...]} 형식인지 확인
        if (obj && obj.responses && Array.isArray(obj.responses)) {
          // responses 배열의 각 항목을 parsed에 추가
          for (const item of obj.responses) {
            if (item && typeof item === "object") {
              parsed.push(item);
            }
          }
        } else {
          // 기존 형식 ({type: ...}) 도 지원 (하위 호환성)
          parsed.push(obj);
        }
      } catch {
        // ignore invalid json chunks
      }
    }
    return parsed;
  };

  const applyParsedResponsesToState = (parsedResponses: StepResponse[]) => {
    if (!parsedResponses.length) {
      return;
    }

    // step은 "현재 단계"로 저장해두기 (임의 질문 이후 복원용)
    for (const r of parsedResponses) {
      if (r?.type === "step") {
        const stepNum = typeof r.step === "number" ? r.step : 0;
        if (stepNum > 0) {
          maxStepSeenRef.current = Math.max(maxStepSeenRef.current, stepNum);
          setMaxStepSeen((prev) => Math.max(prev, stepNum));
        }

        // totalSteps는 "세션 시작 시" 값을 고정한다.
        // 단, 모델이 실제로 더 많은 step을 사용하면(stepNum이 더 커지면) 그때만 최소한으로 올린다.
        if (
          sessionTotalStepsRef.current == null &&
          typeof r.totalSteps === "number"
        ) {
          sessionTotalStepsRef.current = r.totalSteps;
          setSessionTotalSteps(r.totalSteps);
        } else if (
          sessionTotalStepsRef.current != null &&
          stepNum > sessionTotalStepsRef.current
        ) {
          sessionTotalStepsRef.current = stepNum;
          setSessionTotalSteps(stepNum);
        }

        const stableTotal =
          sessionTotalStepsRef.current ??
          (typeof r.totalSteps === "number" ? r.totalSteps : undefined);
        setLastStepBeforeQuestion(
          stableTotal != null ? { ...r, totalSteps: stableTotal } : r
        );
      }
    }

    const complete = parsedResponses.find((r) => r?.type === "complete");
    if (complete) {
      console.log("✅ setIsCompleted(true) 호출:", complete);
      setIsCompleted(true);
      setCurrentStep(complete);
      // 모델이 totalSteps를 크게 잡았다가 일찍 끝내는 경우가 있어, 완료 시점에 실제 진행된 step 수로 보정
      if (maxStepSeenRef.current > 0) {
        sessionTotalStepsRef.current = maxStepSeenRef.current;
        setSessionTotalSteps(maxStepSeenRef.current);
      }
      return;
    }

    const lastStep = [...parsedResponses]
      .reverse()
      .find((r) => r?.type === "step");
    if (lastStep) {
      setIsCompleted(false);
      const stableTotal =
        sessionTotalStepsRef.current ??
        (typeof lastStep.totalSteps === "number" ? lastStep.totalSteps : null);
      const finalStep =
        stableTotal != null
          ? { ...lastStep, totalSteps: stableTotal }
          : lastStep;
      console.log("🔄 setCurrentStep 호출:", finalStep);
      setCurrentStep(finalStep);
      return;
    }
    // text는 메시지 리스트로만 표시한다. (step UI를 text로 덮어쓰지 않는다)
  };

  // 문제가 변경되면 초기화 및 자동 시작
  useEffect(() => {
    if (questionData && !isPdfChat) {
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
      setSessionTotalSteps(null);
      setMaxStepSeen(0);
      sessionTotalStepsRef.current = null;
      maxStepSeenRef.current = 0;
      optionRequestRef.current = null;
      advanceFixInFlightRef.current = false;
      wrongCountPerStepRef.current = new Map();
      // 자동으로 첫 단계 요청
      startTutoring(initialMessages);
    } else if (isPdfChat) {
      // PDF 채팅 모드일 때는 빈 상태로 시작
      setMessages([]);
      setCurrentStep(null);
      setIsCompleted(false);
      setInput("");
      setSessionTotalSteps(null);
      setMaxStepSeen(0);
      sessionTotalStepsRef.current = null;
      maxStepSeenRef.current = 0;
      optionRequestRef.current = null;
      advanceFixInFlightRef.current = false;
      wrongCountPerStepRef.current = new Map();
    }
  }, [questionData?.question_text, isPdfChat]);

  const createSystemPrompt = (data: ChatBoxProps["questionData"]) => {
    if (!data) return "";

    const choicesText =
      data.choices && data.type === "multiple_choice"
        ? "\n선지:\n" + data.choices.map((c, i) => i + 1 + ". " + c).join("\n")
        : "";

    const prompt =
      "당신은 학생의 수학 문제 풀이를 단계별로 안내하는 AI 튜터입니다. 학생은 중학생입니다.\n\n" +
      "⚠️ 절대 규칙: 반드시 JSON 형식으로만 응답하라! 일반 텍스트는 절대 금지!\n" +
      '- 모든 응답은 {"type":"...", ...} 형태여야 함\n' +
      "- JSON 외의 다른 텍스트를 추가하면 시스템 오류 발생\n\n" +
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
      (data.explanation ?? "") +
      "\n\n" +
      "핵심 요구사항(반드시 지켜라):\n" +
      "1) 문제의 난이도와 풀이 과정에 맞게 단계 수를 결정하라:\n" +
      "   - 매우 간단한 문제(직접 계산, 단순 대입 등): 1~2단계 (totalSteps = 1 또는 2)\n" +
      "   - 중간 난이도 문제(인수분해, 연립방정식 등): 2~3단계 (totalSteps = 2 또는 3)\n" +
      "   - 복잡한 문제(여러 단계 변형 필요): 3~4단계 (totalSteps = 3 또는 4)\n" +
      "   - 중요: 억지로 단계를 늘리지 마라! 실제 풀이에 필요한 단계만 구성하라.\n\n" +
      "2) 각 단계는 **수학적 사고 과정**을 담아야 한다:\n" +
      "   - 좋은 단계: 식 정리, 양변 조작, 인수분해, 방정식 풀이, 대입 검증\n" +
      "   - 나쁜 단계: 단순히 정답 숫자 찍기, 의미 없는 선택\n" +
      "   - 각 단계의 질문은 '어떻게 할까요?'가 아니라 '다음 식은?', '양변을 어떻게 정리?', '인수분해 결과는?' 등 구체적으로\n" +
      "   - 예시 (나쁜 단계): '다음 단계에서 x의 값을 어떻게 구할까요?' → 선택지: x=0, x=1, x=2 ← 이건 그냥 찍기!\n" +
      "   - 예시 (좋은 단계): '양변에서 25를 빼면?' → 선택지: $2x^2 = 0$, $2x^2 = 50$, ... ← 이건 실제 풀이 과정!\n\n" +
      "3) options(선택지) 구성 규칙:\n" +
      "   - 반드시 실제 수학적 작업의 결과를 담아라 (계산식, 변형된 식, 중간 결과)\n" +
      '   - 좋은 예: ["$2x^2 = 0$", "$x^2 = 0$", "$(2x+1)(x-3)=0$"]\n' +
      '   - 나쁜 예: ["$x = 0$", "$x = 1$", "$x = 2$"] ← 중간 과정 없이 최종 답만 나열 (찍기 유도)\n' +
      "   - 각 선택지는 '이 단계에서 할 수 있는 수학적 작업의 결과'여야 함\n" +
      "   - 최종 답은 마지막 단계에서만 선택지로 제시\n" +
      '   - 나쁜 예: ["인수분해를 시도한다", "근의 공식을 사용한다"]\n' +
      "   - **정답 선택지는 정확히 1개만 포함!** 나머지는 명백한 오답이어야 함\n" +
      "   - 오답 선택지는 흔한 실수(부호 오류, 계산 실수, 잘못된 공식 적용 등)를 반영\n" +
      "   - 중요: 당신이 생성한 선택지 중 어느 것이 정답인지 정확히 기억하라!\n" +
      "   - 학생이 선택했을 때, 당신이 만든 선택지와 정확히 비교해서 정답/오답을 판단하라\n" +
      "   - 수학적으로 동치인 표현은 모두 정답으로 인정 (예: $(2x+1)(x-3)=0$, $2x^2-5x-3=0$ 둘 다 인수분해 단계에서 정답일 수 있음)\n" +
      "   - 하지만 명백히 틀린 계산(예: $4^2=8$, $2+2=5$)은 반드시 오답 처리\n" +
      "   - options는 3~5개, 마지막은 항상 '이 단계 건너뛰기'\n\n" +
      "4) 학생이 정답 선택지를 고르면:\n" +
      "   - 왜 정답인지 수식/계산 과정 포함 2-3문장 설명\n" +
      "   - 칭찬 후 즉시 다음 단계(step+1) 또는 완료(type=complete)로 진행\n\n" +
      "5) 학생의 선택이 '오답'이면:\n" +
      "   - 어디가 틀렸는지 수식/계산 과정 포함 3-4문장 설명\n" +
      "   - [첫 오답]: 힌트만 제공 (정답 선택지 알려주지 마라!) + 같은 단계 다시 제시\n" +
      "   - [두번째 오답]: 정답 선택지 명확히 알려주고 + 상세 설명 + 다음 단계로 진행\n\n" +
      "6) 임의 질문: type=text로 답변 후 현재 단계 다시 제시\n" +
      "7) 완료 후 질문: type=text로만 답변\n\n" +
      "중요한 출력 규칙:\n" +
      "- 학생이 선택지를 클릭한 경우:\n" +
      "  1) 반드시 type=text로 상세 피드백을 먼저 반환 (정답/오답/건너뛰기 모두)\n" +
      "  2) 그 다음 type=step (다음 단계) 또는 type=complete (완료) 반환\n" +
      "- 정답 선택: step 증가 또는 complete\n" +
      "- 첫 오답: 같은 step 유지 (힌트만)\n" +
      "- 두번째 오답: 정답 공개 후 step 증가\n" +
      "- 마지막 단계(step === totalSteps) 정답 시: type=complete\n" +
      "- 건너뛰기: 무조건 다음 단계로 진행\n\n" +
      "JSON 형식 규칙 (절대 어기지 마라!):\n" +
      "⚠️ 모든 응답은 단일 JSON 객체로 감싸서 반환!\n" +
      '- 형식: {"responses": [{...}, {...}]}\n' +
      "- responses 배열 안에 type=text, type=step, type=complete 등을 담아라\n" +
      "- 올바른 예:\n" +
      '  {"responses":[{"type":"text","content":"잘했어요!"},{"type":"step","step":2,"totalSteps":3,"question":"...","options":[...],"correctIndex":0}]}\n' +
      "- 틀린 예: 여러 개의 JSON을 연속으로 나열 (JSON 모드 오류)\n" +
      '  {"type":"text",...}\\n{"type":"step",...} ← 이렇게 하면 안 됨!\n' +
      "- 수식은 content 안에 $...$ 또는 $$...$$로 감싸기\n" +
      "- LaTeX 백슬래시 이스케이프: \\\\times, \\\\frac, \\\\pm\n\n" +
      "응답 예시:\n" +
      '{"responses":[{"type":"step","step":1,"totalSteps":2,"question":"방정식을 어떻게 풀까요?","options":["$(2x+1)(x-3)=0$","$x^2-2x-3=0$","이 단계 건너뛰기"],"correctIndex":0}]}\n' +
      '{"responses":[{"type":"text","content":"잘했어요! 인수분해가 정확합니다."},{"type":"complete","content":"축하합니다!"}]}\n\n' +
      "중요:\n" +
      "- type=step을 반환할 때 반드시 correctIndex 포함\n" +
      "- 자유 질문에도 responses 배열 안에 담아라\n" +
      '- 단일 응답이라도 배열로 감싸라: {"responses":[{...}]}\n\n' +
      "시작:\n" +
      '- "문제 풀이를 시작해줘" → step=1 제시\n';

    return prompt;
  };

  const startTutoring = async (initialMessages: Message[]) => {
    setLoading(true);
    try {
      const apiMessages = initialMessages.map((m) => ({
        role: m.role,
        content: m.apiContent ?? m.content,
      }));
      const requestBody = isPdfChat
        ? { messages: apiMessages, folderId, useGptKnowledge }
        : { messages: apiMessages };

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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

      // PDF 채팅 모드일 때는 JSON 파싱하지 않음
      if (isPdfChat) {
        const assistantMessages: Message[] = [
          {
            role: "assistant" as const,
            content: assistantMessage,
            sources: data.sources || [], // API에서 받은 sources 저장
          },
        ];
        const updatedMessages = [...initialMessages, ...assistantMessages];
        setMessages(updatedMessages);
      } else {
        // 문제 풀이 모드: JSON 파싱
        const parsedResponses = parseJsonResponses(assistantMessage);

        // 1. type: "text" 모두 수집하여 화면에 표시
        const textResponses = parsedResponses.filter(
          (r) => r?.type === "text" && r.content
        );
        if (textResponses.length > 0) {
          const combinedText = textResponses.map((r) => r.content).join("\n\n");
          setMessages((prev) => [
            ...prev,
            { role: "assistant" as const, content: combinedText },
          ]);
        }

        // 2. step/complete 상태 업데이트
        const stepResponses = parsedResponses.filter(
          (r) => r?.type === "step" || r?.type === "complete"
        );
        if (stepResponses.length > 0) {
          applyParsedResponsesToState(stepResponses);
        }
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

  const sendMessage = async (
    userMessage: string,
    meta?: { fromOption?: boolean; apiMessage?: string }
  ) => {
    if (isPdfChat) {
      // PDF 채팅 모드
      if (!userMessage.trim()) return;
    } else {
      // 문제 풀이 모드
      if (!questionData || !userMessage.trim()) return;
    }

    const newMessages: Message[] = [
      ...messages,
      {
        role: "user" as const,
        content: userMessage,
        apiContent: meta?.apiMessage,
      },
    ];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.apiContent ?? m.content,
      }));
      const requestBody = isPdfChat
        ? { messages: apiMessages, folderId, useGptKnowledge }
        : { messages: apiMessages };

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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

      if (isPdfChat) {
        // PDF 채팅은 JSON 파싱 없이 그대로 표시
        const assistantMessages: Message[] = [
          {
            role: "assistant" as const,
            content: assistantMessage,
            sources: data.sources || [],
          },
        ];
        setMessages((prev) => [...prev, ...assistantMessages]);
      } else {
        // 문제 풀이 모드: JSON 파싱
        const parsedResponses = parseJsonResponses(assistantMessage);
        console.log("📊 Parsed responses:", parsedResponses);
        console.log("🔍 현재 currentStep:", currentStep);
        console.log("🔍 현재 isCompleted:", isCompleted);

        // JSON이 없으면 일반 텍스트로 폴백
        if (parsedResponses.length === 0 && assistantMessage.trim()) {
          console.warn("⚠️ JSON이 없습니다. 일반 텍스트로 표시합니다.");
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant" as const,
              content:
                assistantMessage +
                "\n\n[오류: AI가 JSON 형식을 지키지 않았습니다]",
            },
          ]);
          setLoading(false);
          return;
        }

        // 1) 텍스트 피드백 수집/보정 (선택지 응답인데 text가 없으면 1회 추가 요청)
        const textResponses = parsedResponses.filter(
          (r) => r?.type === "text" && r.content
        );
        const stepResponses = parsedResponses.filter(
          (r) => r?.type === "step" || r?.type === "complete"
        );

        let combinedText = textResponses.map((r) => r.content).join("\n\n");
        const optionCtx = optionRequestRef.current;

        const shouldFixMissingText =
          meta?.fromOption &&
          !combinedText &&
          !feedbackFixInFlightRef.current &&
          !!optionCtx;

        if (shouldFixMissingText && optionCtx) {
          const key = `${optionCtx.step}::${optionCtx.selectedText}`;
          if (lastFeedbackFixKeyRef.current !== key) {
            lastFeedbackFixKeyRef.current = key;
            feedbackFixInFlightRef.current = true;

            try {
              const latestApiMessages = newMessages.map((m) => ({
                role: m.role,
                content: m.apiContent ?? m.content,
              }));

              const fixMessages = [
                ...latestApiMessages,
                {
                  role: "user" as const,
                  content:
                    `[시스템] 방금 선택지에 대한 피드백(type=text)이 누락되었습니다.\n` +
                    `다음 규칙을 반드시 지켜서 JSON만 반환하세요.\n` +
                    `- 반드시 {"type":"text","content":"..."} 딱 1개만 반환\n` +
                    `- content는 수식/계산 과정 포함 2~4문장으로 상세하게\n` +
                    `- type=step/type=complete는 절대 반환하지 마세요 (이미 UI에서 단계 처리를 진행합니다)\n` +
                    `- 방금 선택: ${optionCtx.selectedText}`,
                },
              ];

              const r = await fetch(apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: fixMessages }),
              });
              if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
              const d = await r.json();
              if (d.error) throw new Error(d.error);

              const fixMsg = d.message as string;
              const fixParsed = parseJsonResponses(fixMsg);
              const fixTexts = fixParsed
                .filter((x) => x?.type === "text" && x.content)
                .map((x) => x.content);

              if (fixTexts.length > 0) {
                combinedText = fixTexts.join("\n\n");
              }
            } catch (e) {
              console.error("피드백 보정 요청 실패:", e);
            } finally {
              feedbackFixInFlightRef.current = false;
            }
          }
        }

        if (combinedText) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant" as const, content: combinedText },
          ]);
        }

        // 2) step/complete 상태 업데이트 (텍스트를 먼저 표시한 뒤 단계 반영)
        if (stepResponses.length > 0) {
          applyParsedResponsesToState(stepResponses);
        }

        // 3) 오답 카운터 관리
        if (meta?.fromOption && optionCtx) {
          const flatText = combinedText.replace(/\n+/g, " ");
          const isCorrectOrSkip = looksCorrect(flatText) || optionCtx.isSkip;
          const isWrong = looksWrong(flatText);

          // step이 증가했는지 확인
          const receivedStep = stepResponses.find((r) => r?.type === "step");
          const receivedStepNum = receivedStep?.step ?? null;
          const didAdvance =
            stepResponses.some((r) => r?.type === "complete") ||
            (receivedStepNum != null && receivedStepNum > optionCtx.step);

          if (isCorrectOrSkip || didAdvance) {
            // 정답이거나 단계가 올라갔으면 카운터 리셋
            wrongCountPerStepRef.current.delete(optionCtx.step);
          } else if (isWrong) {
            // 오답이면 카운터 증가
            const currentCount =
              wrongCountPerStepRef.current.get(optionCtx.step) || 0;
            wrongCountPerStepRef.current.set(optionCtx.step, currentCount + 1);
            console.log(
              `⚠️ 오답 카운트: step ${optionCtx.step} = ${currentCount + 1}회`
            );
          }
        }

        // ===== 로직 보정: "정답"인데도 같은 단계/step 미진행이면 다음 단계만 재요청 =====
        if (
          meta?.fromOption &&
          !isCompleted &&
          !advanceFixInFlightRef.current &&
          optionRequestRef.current
        ) {
          const flatText = combinedText.replace(/\n+/g, " ");
          const isCorrectOrSkip =
            looksCorrect(flatText) || optionRequestRef.current.isSkip;
          const isWrong = looksWrong(flatText);

          if (isCorrectOrSkip && !isWrong) {
            const prevStep = optionRequestRef.current.step;
            const latestStep = stepResponses.find((r) => r?.type === "step");
            const latestComplete = stepResponses.find(
              (r) => r?.type === "complete"
            );

            const receivedStepNum = latestStep?.step ?? null;
            const didAdvance =
              latestComplete ||
              (receivedStepNum != null && receivedStepNum > prevStep);

            if (!didAdvance) {
              console.log(
                "⚠️ 정답인데 step이 안 올라감 - 강제로 다음 단계 요청"
              );
              advanceFixInFlightRef.current = true;

              // setTimeout으로 약간 지연시켜서 현재 상태 업데이트가 완료된 후 실행
              setTimeout(async () => {
                try {
                  const nextStepNum = prevStep + 1;
                  const total =
                    sessionTotalStepsRef.current ??
                    currentStep?.totalSteps ??
                    3;

                  // 현재 messages state를 직접 참조하지 말고, 최신 newMessages 기반으로
                  const latestApiMessages = newMessages.map((m) => ({
                    role: m.role,
                    content: m.apiContent ?? m.content,
                  }));

                  // 텍스트 응답도 추가 (이미 화면에 표시된 피드백)
                  if (combinedText) {
                    latestApiMessages.push({
                      role: "assistant" as const,
                      content: combinedText,
                    });
                  }

                  const extraApiMessages = [
                    ...latestApiMessages,
                    {
                      role: "user" as const,
                      content:
                        `[시스템] 방금 선택은 정답/건너뛰기로 처리됨. 다음 단계로 진행하세요.\n` +
                        `- 다음 step: ${nextStepNum}\n` +
                        `- totalSteps: ${total}\n` +
                        `중요: type=text 설명은 이미 보냈으므로, 이제 type=step(step=${nextStepNum}) 또는 type=complete만 JSON으로 반환하세요.`,
                    },
                  ];

                  const r = await fetch(apiEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages: extraApiMessages }),
                  });

                  if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
                  const d = await r.json();
                  if (d.error) throw new Error(d.error);

                  const extraMsg = d.message as string;
                  const extraParsed = parseJsonResponses(extraMsg);

                  // 텍스트는 무시하고 step/complete만 적용
                  const extraSteps = extraParsed.filter(
                    (r) => r?.type === "step" || r?.type === "complete"
                  );

                  if (extraSteps.length > 0) {
                    const complete = extraSteps.find(
                      (r) => r?.type === "complete"
                    );
                    if (complete) {
                      applyParsedResponsesToState([complete]);
                    } else {
                      const steps = extraSteps.filter(
                        (r) => r?.type === "step"
                      );
                      const best = steps.reduce<StepResponse | null>(
                        (acc, cur) => {
                          const a = acc?.step ?? -1;
                          const b = cur?.step ?? -1;
                          return b > a ? cur : acc;
                        },
                        null
                      );

                      const newStepNum =
                        best?.type === "step" && typeof best.step === "number"
                          ? best.step
                          : null;

                      // 현재 step과 다른 step만 적용
                      if (newStepNum != null && newStepNum > prevStep) {
                        applyParsedResponsesToState([best!]);
                      } else {
                        console.log("⚠️ 보정 응답도 같은 step 반환 - 무시");
                      }
                    }
                  }
                } catch (err) {
                  console.error("보정 요청 실패:", err);
                } finally {
                  advanceFixInFlightRef.current = false;
                }
              }, 100); // 100ms 지연
            }
          }
        }
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

  const handleOptionClick = (option: string, optionIndex: number) => {
    // 연타로 같은 선택지가 여러 번 전송되는 문제 방지
    if (loading) return;
    const stepLabel =
      currentStep?.type === "step"
        ? ` (현재 단계: ${currentStep.step}/${
            sessionTotalSteps ?? currentStep.totalSteps
          })`
        : "";

    const isSkip = option.includes("건너뛰기");
    if (currentStep?.type === "step" && typeof currentStep.step === "number") {
      optionRequestRef.current = {
        step: currentStep.step,
        isSkip,
        selectedText: option,
      };
    } else {
      optionRequestRef.current = null;
    }

    // 현재 단계의 오답 횟수 조회
    const wrongCount =
      currentStep?.type === "step" && typeof currentStep.step === "number"
        ? wrongCountPerStepRef.current.get(currentStep.step) || 0
        : 0;

    // correctIndex 확인 (정답 판단용)
    const correctIdx =
      currentStep?.type === "step" ? currentStep.correctIndex : undefined;
    const isCorrectChoice =
      correctIdx !== undefined && optionIndex === correctIdx;

    // 화면에는 선택지 내용 그대로 표시
    sendMessage(option, {
      fromOption: true,
      apiMessage:
        `학생이 선택지를 골랐습니다.\n` +
        `- step: ${currentStep?.type === "step" ? currentStep.step : "?"}\n` +
        `- totalSteps: ${
          sessionTotalSteps ?? currentStep?.totalSteps ?? "?"
        }\n` +
        `- stepQuestion: ${
          currentStep?.type === "step" ? currentStep.question : ""
        }\n` +
        `- options: ${(currentStep?.type === "step"
          ? currentStep.options
          : []
        )?.join(" | ")}\n` +
        `- correctIndex: ${
          correctIdx !== undefined ? correctIdx : "미지정"
        } (0부터 시작, 건너뛰기 제외)\n` +
        `- selectedIndex: ${optionIndex}${stepLabel}\n` +
        `- selectedText: ${option}\n` +
        `- isSkip: ${isSkip}\n` +
        `- wrongCountSoFar: ${wrongCount}\n\n` +
        `정답 판단:\n` +
        `${
          isSkip
            ? "- 학생이 건너뛰기를 선택했으므로 정답 판단 없이 다음 단계로 진행"
            : correctIdx !== undefined
            ? `- correctIndex=${correctIdx}와 selectedIndex=${optionIndex}을 비교:\n` +
              `  ${isCorrectChoice ? "✅ 정답입니다!" : "❌ 오답입니다."}\n` +
              `- 이 판단을 절대적 기준으로 삼아라. 다른 추측이나 해석 금지!`
            : "- correctIndex가 없으므로 내용을 보고 판단 (수학적 정확성 기준)"
        }\n\n` +
        `반드시 지켜야 할 규칙:\n` +
        `1. 선택지에 대한 피드백을 type=text로 먼저 제공한다.\n` +
        `   - 정답: 왜 정답인지 수식/계산 과정 포함 2~3문장 상세 설명\n` +
        `   - 첫 번째 오답(wrongCountSoFar=0): 어디가 틀렸는지 + 올바른 접근 힌트만 (정답 선택지는 절대 알려주지 마라!)\n` +
        `   - 두 번째 오답(wrongCountSoFar=1): 정답 선택지를 명확히 알려주고 + 왜 그것이 정답인지 상세 설명\n` +
        `2. 피드백 후 반드시 type=step 또는 type=complete을 반환한다. (type=text만 보내고 끝내면 UI가 멈춘다!)\n` +
        `3. ${
          isSkip
            ? "건너뛰기를 선택했으므로 거부하지 말고 즉시 다음 단계(step+1) 또는 complete로 진행한다."
            : wrongCount === 0
            ? "정답이면 다음 단계로 진행, 첫 오답이면 피드백(힌트만) 후 같은 단계를 다시 제시한다."
            : "정답이면 다음 단계로 진행, 두 번째 오답이면 정답 공개 후 다음 단계(step+1)로 진행한다."
        }\n` +
        `4. 정답 기준: 현재 step의 질문에 대한 답이 맞는지만 판단. 전체 문제를 아직 안 풀었다는 이유로 오답 처리 금지.`,
    });
  };

  // PDF 채팅 모드가 아니고 questionData가 없으면 안내 메시지 표시
  if (!questionData && !isPdfChat) {
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
        <h2 className="text-lg font-bold">
          {isPdfChat ? "PDF AI 어시스턴트" : "AI 튜터"}
        </h2>
        <p className="text-sm opacity-90">
          {isPdfChat
            ? "선택한 폴더 내 PDF를 참조하여 답변합니다"
            : "단계별로 문제를 풀어봅시다"}
        </p>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 min-h-0">
        {messages
          .filter((msg) => msg.role !== "system" && !msg.hidden)
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
              if (isPdfChat) {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[80%]">
                      <div className="bg-white border border-gray-200 px-4 py-2 rounded-lg shadow-sm whitespace-pre-wrap break-words">
                        <MathText text={msg.content} />
                      </div>

                      {/* PDF 채팅 출처 정보 UI */}
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-blue-700 font-semibold">
                              📎 참고 문서
                            </span>
                          </div>
                          <div className="space-y-1">
                            {Array.from(
                              new Set(msg.sources.map((s) => s.pdfName))
                            ).map((pdfName, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-2 text-blue-800"
                              >
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                                <span className="font-medium">{pdfName}</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 text-xs text-blue-600">
                            {msg.sources.length}개의 관련 내용을 찾았습니다
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // 문제 풀이 모드: content 그대로 표시
              return (
                <div key={i} className="flex justify-start">
                  <div className="bg-white border border-gray-200 px-4 py-2 rounded-lg max-w-[80%] shadow-sm whitespace-pre-wrap break-words">
                    <MathText text={msg.content} />
                  </div>
                </div>
              );
            }
          })}

        {/* 단계별 옵션 버튼 (문제 풀이 모드만) */}
        {!isPdfChat &&
          currentStep &&
          currentStep.type === "step" &&
          !loading && (
            <div className="bg-purple-50 border-2 border-purple-200 p-4 rounded-lg space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-purple-700">
                  📍 {currentStep.step}단계
                </span>
              </div>
              <div className="font-medium text-gray-900 text-base overflow-wrap-anywhere break-words">
                <MathText text={currentStep.question || ""} />
              </div>
              <div className="space-y-2 mt-3">
                {currentStep.options?.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleOptionClick(option, idx)}
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

        {/* 완료 메시지 (문제 풀이 모드만) */}
        {!isPdfChat &&
          currentStep &&
          currentStep.type === "complete" &&
          !loading && (
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
            placeholder={
              isPdfChat
                ? "PDF에 대해 질문하세요..."
                : "궁금한 점을 질문하세요..."
            }
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

        {/* PDF 채팅 모드일 때만 토글 표시 */}
        {isPdfChat && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <label
                htmlFor="gpt-knowledge-toggle"
                className="text-sm text-gray-700 cursor-pointer"
              >
                ChatGPT 자체 지식도 참조하여 답변합니다
              </label>
            </div>
            <button
              id="gpt-knowledge-toggle"
              onClick={() => setUseGptKnowledge(!useGptKnowledge)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                useGptKnowledge ? "bg-blue-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  useGptKnowledge ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
