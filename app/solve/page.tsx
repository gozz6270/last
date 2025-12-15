"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import MathText from "@/components/MathText";
import ChatBox from "@/components/ChatBox";

interface Chapter {
  id: string;
  title: string;
  order: number;
}

interface Section {
  id: string;
  chapter_id: string;
  title: string;
  order: number;
}

interface Question {
  id: string;
  section_id: string;
  question_text: string;
  type: "multiple_choice" | "short_answer";
  choices: string[] | null;
  answer: string;
  explanation: string;
  order: number;
}

export default function SolvePage() {
  // 데이터
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);

  // 선택된 단원
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);

  // 문제 풀이 상태
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);

  // 초기 데이터 로드
  useEffect(() => {
    fetchChapters();
    fetchSections();
  }, []);

  const fetchChapters = async () => {
    const { data, error } = await supabase
      .from("chapters")
      .select("*")
      .order("order", { ascending: true });
    if (!error) setChapters(data || []);
  };

  const fetchSections = async () => {
    const { data, error } = await supabase
      .from("sections")
      .select("*")
      .order("order", { ascending: true });
    if (!error) setSections(data || []);
  };

  const loadQuestions = async (sectionId: string) => {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("section_id", sectionId)
      .order("order", { ascending: true });

    if (!error && data) {
      setQuestions(data);
      setCurrentIndex(0);
      setUserAnswer("");
      setShowResult(false);

      // 선택된 중단원 정보 저장
      const section = sections.find((s) => s.id === sectionId);
      setSelectedSection(section || null);

      if (section) {
        const chapter = chapters.find((c) => c.id === section.chapter_id);
        setSelectedChapter(chapter || null);
      }
    }
  };

  const handleCheckAnswer = () => {
    setShowResult(true);
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setUserAnswer("");
      setShowResult(false);
    }
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setUserAnswer("");
      setShowResult(false);
    }
  };

  const currentQuestion = questions[currentIndex];

  return (
    <div className="grid grid-cols-[250px_1fr_400px] gap-4 h-full min-h-0 p-4 overflow-hidden">
      {/* 왼쪽: 단원 선택 사이드바 */}
      <div className="border rounded shadow overflow-y-auto bg-white p-4">
        <h2 className="text-lg font-bold mb-4">단원 선택</h2>
        <div className="space-y-4">
          {chapters.map((chapter) => (
            <div key={chapter.id}>
              <div className="font-bold text-gray-800 mb-2">
                {chapter.title}
              </div>
              <div className="ml-2 space-y-1">
                {sections
                  .filter((s) => s.chapter_id === chapter.id)
                  .map((section) => (
                    <button
                      key={section.id}
                      onClick={() => loadQuestions(section.id)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        selectedSection?.id === section.id
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 hover:bg-gray-200"
                      }`}
                    >
                      {section.title}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 중간: 문제 풀이 영역 */}
      <div className="border rounded shadow overflow-y-auto bg-white p-6">
        {!currentQuestion ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            왼쪽에서 중단원을 선택하세요
          </div>
        ) : (
          <div className="space-y-6">
            {/* 상단: 경로 표시 */}
            <div className="text-sm text-gray-600">
              {selectedChapter?.title} &gt; {selectedSection?.title}
            </div>

            {/* 문제 번호 및 진행률 */}
            <div className="space-y-2">
              <div className="text-lg font-semibold">
                문제 {currentIndex + 1} / {questions.length}
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${((currentIndex + 1) / questions.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* 문제 텍스트 */}
            <div className="text-lg">
              <MathText text={currentQuestion.question_text} />
            </div>

            {/* 객관식 */}
            {currentQuestion.type === "multiple_choice" && (
              <div className="space-y-2">
                {currentQuestion.choices &&
                  JSON.parse(JSON.stringify(currentQuestion.choices)).map(
                    (choice: string, index: number) => {
                      const choiceNum = String(index + 1);
                      const isCorrect = choiceNum === currentQuestion.answer;
                      const isSelected = userAnswer === choiceNum;

                      let bgClass = "bg-white hover:bg-gray-50";
                      if (showResult && isSelected && isCorrect) {
                        bgClass = "bg-green-100 border-green-500";
                      } else if (showResult && isSelected && !isCorrect) {
                        bgClass = "bg-red-100 border-red-500";
                      }

                      return (
                        <label
                          key={index}
                          className={`flex items-center gap-3 p-4 border-2 rounded cursor-pointer transition-colors ${bgClass}`}
                        >
                          <input
                            type="radio"
                            name="answer"
                            value={choiceNum}
                            checked={userAnswer === choiceNum}
                            onChange={(e) => setUserAnswer(e.target.value)}
                            disabled={showResult}
                            className="w-4 h-4"
                          />
                          <div className="flex-1">
                            <MathText text={choice} />
                          </div>
                        </label>
                      );
                    }
                  )}
              </div>
            )}

            {/* 단답형 */}
            {currentQuestion.type === "short_answer" && (
              <div>
                <input
                  type="text"
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  disabled={showResult}
                  placeholder="정답을 입력하세요"
                  className={`w-full px-4 py-3 border-2 rounded ${
                    showResult && userAnswer === currentQuestion.answer
                      ? "border-green-500 bg-green-50"
                      : showResult
                      ? "border-red-500 bg-red-50"
                      : "border-gray-300"
                  }`}
                />
              </div>
            )}

            {/* 정답 확인 버튼 */}
            {!showResult && (
              <button
                onClick={handleCheckAnswer}
                disabled={!userAnswer}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                정답 확인
              </button>
            )}

            {/* 결과 및 해설 */}
            {showResult && (
              <div className="border-t pt-4 space-y-4">
                {/* 정답 여부 */}
                <div
                  className={`p-4 rounded-lg text-center font-bold text-lg ${
                    userAnswer === currentQuestion.answer
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {userAnswer === currentQuestion.answer
                    ? "✓ 정답입니다!"
                    : "✗ 틀렸습니다"}
                </div>

                {/* 정답 표시 */}
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="font-semibold text-blue-900 mb-2">정답</div>
                  <div className="text-blue-800">
                    {currentQuestion.type === "multiple_choice" ? (
                      <div>
                        <div className="font-medium">
                          {currentQuestion.answer}번
                        </div>
                        {currentQuestion.choices && (
                          <div className="mt-2">
                            <MathText
                              text={
                                currentQuestion.choices[
                                  parseInt(currentQuestion.answer) - 1
                                ]
                              }
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <MathText text={currentQuestion.answer} />
                    )}
                  </div>
                </div>

                {/* 해설 */}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="font-semibold text-gray-900 mb-2">해설</div>
                  <div className="text-gray-700">
                    <MathText text={currentQuestion.explanation} />
                  </div>
                </div>
              </div>
            )}

            {/* 이전/다음 버튼 */}
            <div className="flex gap-4 border-t pt-4">
              <button
                onClick={handlePrevious}
                disabled={currentIndex === 0}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                이전 문제
              </button>
              <button
                onClick={handleNext}
                disabled={currentIndex === questions.length - 1}
                className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                다음 문제
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 오른쪽: 채팅 영역 */}
      <div className="border rounded shadow overflow-hidden flex flex-col">
        <ChatBox questionData={currentQuestion} />
      </div>
    </div>
  );
}


