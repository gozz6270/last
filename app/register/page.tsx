"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import MathText from "@/components/MathText";

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
  type: "multiple_choice" | "short_answer";
  question_text: string;
  choices: string[] | null;
  answer: string;
  explanation: string | null;
  order: number;
}

export default function RegisterPage() {
  // 대단원/중단원 상태
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null
  );
  const [selectedSection, setSelectedSection] = useState<Section | null>(null);

  // 문제 관련 상태
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number>(0);
  const [isNewQuestion, setIsNewQuestion] = useState(false);

  // 폼 상태
  const [questionType, setQuestionType] = useState<
    "multiple_choice" | "short_answer"
  >("multiple_choice");
  const [questionText, setQuestionText] = useState("");
  const [choices, setChoices] = useState(["", "", "", ""]);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");

  // LaTeX 도구 상태
  const [showLatexHelper, setShowLatexHelper] = useState(false);
  const [currentEditingField, setCurrentEditingField] = useState<
    | "question"
    | "explanation"
    | "answer"
    | "choice0"
    | "choice1"
    | "choice2"
    | "choice3"
    | null
  >(null);

  // LaTeX 템플릿
  const latexTemplates = [
    { name: "분수", latex: "\\frac{a}{b}", preview: "a/b" },
    { name: "제곱근", latex: "\\sqrt{x}", preview: "√x" },
    { name: "n제곱근", latex: "\\sqrt[3]{x}", preview: "³√x" },
    { name: "거듭제곱", latex: "x^{2}", preview: "x²" },
    { name: "아래첨자", latex: "x_{1}", preview: "x₁" },
    { name: "곱하기 ×", latex: "\\times", preview: "×" },
    { name: "나누기 ÷", latex: "\\div", preview: "÷" },
    { name: "플러스마이너스 ±", latex: "\\pm", preview: "±" },
    { name: "같지않음 ≠", latex: "\\neq", preview: "≠" },
    { name: "작거나같음 ≤", latex: "\\leq", preview: "≤" },
    { name: "크거나같음 ≥", latex: "\\geq", preview: "≥" },
    { name: "작음 <", latex: "<", preview: "<" },
    { name: "큼 >", latex: ">", preview: ">" },
    { name: "적분", latex: "\\int_{0}^{1} x dx", preview: "∫₀¹ x dx" },
    { name: "시그마", latex: "\\sum_{i=1}^{n} i", preview: "Σᵢ₌₁ⁿ i" },
    { name: "극한", latex: "\\lim_{x \\to 0}", preview: "lim(x→0)" },
    {
      name: "행렬 2x2",
      latex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
      preview: "[a b; c d]",
    },
    { name: "알파 α", latex: "\\alpha", preview: "α" },
    { name: "베타 β", latex: "\\beta", preview: "β" },
    { name: "세타 θ", latex: "\\theta", preview: "θ" },
    { name: "파이 π", latex: "\\pi", preview: "π" },
    { name: "무한대 ∞", latex: "\\infty", preview: "∞" },
  ];

  // LaTeX 템플릿 삽입
  const insertLatex = (latex: string, isBlock: boolean = false) => {
    const wrapper = isBlock ? `$$${latex}$$` : `$${latex}$`;

    if (currentEditingField === "question") {
      setQuestionText(questionText + wrapper);
    } else if (currentEditingField === "explanation") {
      setExplanation(explanation + wrapper);
    } else if (currentEditingField === "answer") {
      setAnswer(answer + wrapper);
    } else if (currentEditingField?.startsWith("choice")) {
      const index = parseInt(currentEditingField.replace("choice", ""));
      const newChoices = [...choices];
      newChoices[index] = newChoices[index] + wrapper;
      setChoices(newChoices);
    }

    setShowLatexHelper(false);
  };

  // 이름 변경 모드
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingChapterTitle, setEditingChapterTitle] = useState("");
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionTitle, setEditingSectionTitle] = useState("");

  // 드래그 앤 드롭
  const [draggedChapter, setDraggedChapter] = useState<Chapter | null>(null);
  const [draggedSection, setDraggedSection] = useState<Section | null>(null);

  // 초기 데이터 로드
  useEffect(() => {
    fetchChapters();
    fetchSections();
  }, []);

  // 중단원 선택 시 문제 로드
  useEffect(() => {
    if (selectedSectionId) {
      const section = sections.find((s) => s.id === selectedSectionId);
      setSelectedSection(section || null);
      fetchQuestions(selectedSectionId);
    } else {
      setQuestions([]);
      setSelectedQuestionIndex(0);
      setSelectedSection(null);
    }
  }, [selectedSectionId, sections]);

  // 문제 선택 시 폼 채우기
  useEffect(() => {
    if (isNewQuestion) {
      clearForm();
    } else if (questions.length > 0 && questions[selectedQuestionIndex]) {
      const q = questions[selectedQuestionIndex];
      setQuestionType(q.type);
      setQuestionText(q.question_text);
      setChoices(q.choices || ["", "", "", ""]);
      setAnswer(q.answer);
      setExplanation(q.explanation || "");
    }
  }, [selectedQuestionIndex, isNewQuestion, questions]);

  const fetchChapters = async () => {
    try {
      const { data, error } = await supabase
        .from("chapters")
        .select("*")
        .order("order", { ascending: true });
      if (error) {
        console.error("chapters 로드 실패:", error);
        return;
      }
      setChapters(data || []);
    } catch (e) {
      console.error("chapters 로드 중 예외:", e);
    }
  };

  const fetchSections = async () => {
    try {
      const { data, error } = await supabase
        .from("sections")
        .select("*")
        .order("order", { ascending: true });
      if (error) {
        console.error("sections 로드 실패:", error);
        return;
      }
      setSections(data || []);
    } catch (e) {
      console.error("sections 로드 중 예외:", e);
    }
  };

  const fetchQuestions = async (sectionId: string) => {
    try {
      const { data, error } = await supabase
        .from("questions")
        .select("*")
        .eq("section_id", sectionId)
        .order("order", { ascending: true });
      if (error) {
        console.error("questions 로드 실패:", error);
        return;
      }

      setQuestions(data || []);
      // 문제가 0개면 신규 등록 모드
      if (data && data.length === 0) {
        setIsNewQuestion(true);
      } else {
        setSelectedQuestionIndex(0);
        setIsNewQuestion(false);
      }
    } catch (e) {
      console.error("questions 로드 중 예외:", e);
    }
  };

  const clearForm = () => {
    setQuestionType("multiple_choice");
    setQuestionText("");
    setChoices(["", "", "", ""]);
    setAnswer("");
    setExplanation("");
  };

  // 대단원 추가
  const handleAddChapter = async () => {
    const title = prompt("대단원 제목을 입력하세요:");
    if (!title || !title.trim()) return;

    const { error } = await supabase
      .from("chapters")
      .insert([{ title: title.trim(), order: chapters.length }]);

    if (!error) {
      fetchChapters();
    } else {
      alert("대단원 추가 실패");
    }
  };

  // 중단원 추가
  const handleAddSection = async (chapterId: string) => {
    const title = prompt("중단원 제목을 입력하세요:");
    if (!title || !title.trim()) return;

    const sectionsInChapter = sections.filter(
      (s) => s.chapter_id === chapterId
    );

    const { error } = await supabase.from("sections").insert([
      {
        chapter_id: chapterId,
        title: title.trim(),
        order: sectionsInChapter.length,
      },
    ]);

    if (!error) {
      fetchSections();
    } else {
      alert("중단원 추가 실패");
    }
  };

  // 대단원 이름 변경
  const handleUpdateChapter = async (chapter: Chapter) => {
    setEditingChapterId(chapter.id);
    setEditingChapterTitle(chapter.title);
  };

  const saveChapterTitle = async (chapterId: string) => {
    if (!editingChapterTitle.trim()) {
      alert("제목을 입력하세요.");
      return;
    }

    const { error } = await supabase
      .from("chapters")
      .update({ title: editingChapterTitle.trim() })
      .eq("id", chapterId);

    if (!error) {
      setEditingChapterId(null);
      fetchChapters();
    }
  };

  // 중단원 이름 변경
  const handleUpdateSection = async (section: Section) => {
    setEditingSectionId(section.id);
    setEditingSectionTitle(section.title);
  };

  const saveSectionTitle = async (sectionId: string) => {
    if (!editingSectionTitle.trim()) {
      alert("제목을 입력하세요.");
      return;
    }

    const { error } = await supabase
      .from("sections")
      .update({ title: editingSectionTitle.trim() })
      .eq("id", sectionId);

    if (!error) {
      setEditingSectionId(null);
      // 순서 유지를 위해 state만 직접 업데이트
      setSections(
        sections.map((s) =>
          s.id === sectionId ? { ...s, title: editingSectionTitle.trim() } : s
        )
      );
    }
  };

  // 대단원 삭제
  const handleDeleteChapter = async (chapter: Chapter) => {
    if (
      !confirm(
        `정말로 "${chapter.title}" 대단원을 삭제하시겠습니까?\n하위 중단원과 문제도 모두 삭제됩니다.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("chapters")
      .delete()
      .eq("id", chapter.id);

    if (!error) {
      fetchChapters();
      if (selectedSection && selectedSection.chapter_id === chapter.id) {
        setSelectedSectionId(null);
      }
    } else {
      alert("삭제 실패");
    }
  };

  // 중단원 삭제
  const handleDeleteSection = async (section: Section) => {
    if (
      !confirm(
        `정말로 "${section.title}" 중단원을 삭제하시겠습니까?\n하위 문제도 모두 삭제됩니다.`
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("sections")
      .delete()
      .eq("id", section.id);

    if (!error) {
      fetchSections();
      if (selectedSectionId === section.id) {
        setSelectedSectionId(null);
      }
    } else {
      alert("삭제 실패");
    }
  };

  // 드래그 앤 드롭 - 대단원
  const handleChapterDragStart = (chapter: Chapter) => {
    setDraggedChapter(chapter);
  };

  const handleChapterDrop = async (targetChapter: Chapter) => {
    if (!draggedChapter || draggedChapter.id === targetChapter.id) return;

    const reordered = [...chapters];
    const fromIndex = reordered.findIndex((c) => c.id === draggedChapter.id);
    const toIndex = reordered.findIndex((c) => c.id === targetChapter.id);

    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, draggedChapter);

    // DB 업데이트
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from("chapters")
        .update({ order: i })
        .eq("id", reordered[i].id);
    }

    setDraggedChapter(null);
    fetchChapters();
  };

  // 드래그 앤 드롭 - 중단원
  const handleSectionDragStart = (section: Section) => {
    setDraggedSection(section);
  };

  const handleSectionDrop = async (targetSection: Section) => {
    if (!draggedSection || draggedSection.id === targetSection.id) return;
    if (draggedSection.chapter_id !== targetSection.chapter_id) {
      alert("같은 대단원 내에서만 이동 가능합니다.");
      return;
    }

    const sectionsInChapter = sections.filter(
      (s) => s.chapter_id === targetSection.chapter_id
    );
    const reordered = [...sectionsInChapter];
    const fromIndex = reordered.findIndex((s) => s.id === draggedSection.id);
    const toIndex = reordered.findIndex((s) => s.id === targetSection.id);

    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, draggedSection);

    // DB 업데이트
    for (let i = 0; i < reordered.length; i++) {
      await supabase
        .from("sections")
        .update({ order: i })
        .eq("id", reordered[i].id);
    }

    setDraggedSection(null);
    fetchSections();
  };

  // 문제 저장 (신규)
  const handleSaveNewQuestion = async () => {
    if (!selectedSectionId || !questionText.trim() || !answer.trim()) {
      alert("필수 항목을 입력해주세요.");
      return;
    }

    if (questionType === "multiple_choice") {
      const emptyChoices = choices.filter((c) => !c.trim());
      if (emptyChoices.length > 0) {
        alert("모든 선지를 입력해주세요.");
        return;
      }
    }

    const questionData: any = {
      section_id: selectedSectionId,
      type: questionType,
      question_text: questionText,
      answer: answer,
      explanation: explanation || null,
      order: questions.length,
    };

    if (questionType === "multiple_choice") {
      questionData.choices = choices;
    }

    const { error } = await supabase.from("questions").insert([questionData]);

    if (error) {
      alert(`문제 등록 실패: ${error.message}`);
    } else {
      alert("문제가 등록되었습니다.");
      fetchQuestions(selectedSectionId);
      setIsNewQuestion(false);
    }
  };

  // 문제 수정
  const handleUpdateQuestion = async () => {
    const currentQuestion = questions[selectedQuestionIndex];
    if (!currentQuestion) return;

    const questionData: any = {
      type: questionType,
      question_text: questionText,
      answer: answer,
      explanation: explanation || null,
    };

    if (questionType === "multiple_choice") {
      questionData.choices = choices;
    } else {
      questionData.choices = null;
    }

    const { error } = await supabase
      .from("questions")
      .update(questionData)
      .eq("id", currentQuestion.id);

    if (error) {
      alert(`수정 실패: ${error.message}`);
    } else {
      alert("문제가 수정되었습니다.");
      fetchQuestions(selectedSectionId!);
    }
  };

  // 문제 삭제
  const handleDeleteQuestion = async () => {
    const currentQuestion = questions[selectedQuestionIndex];
    if (!currentQuestion) return;

    if (
      !confirm(`정말로 ${selectedQuestionIndex + 1}번 문제를 삭제하시겠습니까?`)
    ) {
      return;
    }

    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", currentQuestion.id);

    if (error) {
      alert(`삭제 실패: ${error.message}`);
    } else {
      alert("문제가 삭제되었습니다.");

      // 남은 문제들의 order 재정렬
      const remainingQuestions = questions.filter(
        (_, i) => i !== selectedQuestionIndex
      );
      for (let i = 0; i < remainingQuestions.length; i++) {
        await supabase
          .from("questions")
          .update({ order: i })
          .eq("id", remainingQuestions[i].id);
      }

      // 문제 목록 다시 불러오기
      await fetchQuestions(selectedSectionId!);

      // 선택된 인덱스 조정
      if (remainingQuestions.length > 0) {
        setSelectedQuestionIndex(
          Math.min(selectedQuestionIndex, remainingQuestions.length - 1)
        );
      } else {
        setSelectedQuestionIndex(0);
      }
    }
  };

  // 문제 이동
  const handleMoveQuestion = async () => {
    const currentQuestion = questions[selectedQuestionIndex];
    if (!currentQuestion) return;

    const targetPosition = prompt(
      `이 문제를 몇 번 문제로 이동할까요? (현재: ${
        selectedQuestionIndex + 1
      }번, 전체: ${questions.length}개)`
    );
    if (targetPosition === null) return;

    const targetIndex = parseInt(targetPosition, 10) - 1;
    if (
      isNaN(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= questions.length
    ) {
      alert("유효한 번호를 입력해주세요.");
      return;
    }

    // 순서 재정렬
    const reorderedQuestions = [...questions];
    const [movedQuestion] = reorderedQuestions.splice(selectedQuestionIndex, 1);
    reorderedQuestions.splice(targetIndex, 0, movedQuestion);

    // DB 업데이트
    for (let i = 0; i < reorderedQuestions.length; i++) {
      await supabase
        .from("questions")
        .update({ order: i })
        .eq("id", reorderedQuestions[i].id);
    }

    alert("문제가 이동되었습니다.");
    fetchQuestions(selectedSectionId!);
    setSelectedQuestionIndex(targetIndex);
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* 왼쪽 패널: 대단원/중단원 */}
      <div className="w-80 border-r border-gray-300 overflow-y-auto bg-gray-50 p-4">
        <h2 className="text-xl font-bold mb-4">단원 목록</h2>

        {chapters.map((chapter) => (
          <div key={chapter.id} className="mb-4">
            {/* 대단원 */}
            <div
              draggable
              onDragStart={() => handleChapterDragStart(chapter)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleChapterDrop(chapter)}
              className="font-semibold text-gray-800 mb-2 p-2 bg-white rounded cursor-move hover:bg-gray-100 flex items-center justify-between"
            >
              {editingChapterId === chapter.id ? (
                <div className="flex gap-1 flex-1 items-center">
                  <input
                    type="text"
                    value={editingChapterTitle}
                    onChange={(e) => setEditingChapterTitle(e.target.value)}
                    className="flex-1 px-2 py-1 border rounded text-sm min-w-0"
                    autoFocus
                  />
                  <button
                    onClick={() => saveChapterTitle(chapter.id)}
                    className="px-2 py-1 bg-indigo-500 text-white rounded text-xs hover:bg-indigo-600 transition-colors whitespace-nowrap"
                  >
                    💾
                  </button>
                  <button
                    onClick={() => setEditingChapterId(null)}
                    className="px-2 py-1 bg-slate-300 text-slate-700 rounded text-xs hover:bg-slate-400 transition-colors whitespace-nowrap"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <span>{chapter.title}</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleUpdateChapter(chapter)}
                      className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition-colors"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDeleteChapter(chapter)}
                      className="px-2 py-1 text-xs bg-rose-100 hover:bg-rose-200 rounded text-rose-700 transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 중단원 목록 */}
            <div className="ml-4 space-y-1">
              {sections
                .filter((s) => s.chapter_id === chapter.id)
                .map((section) => (
                  <div
                    key={section.id}
                    draggable
                    onDragStart={() => handleSectionDragStart(section)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleSectionDrop(section)}
                    className={`cursor-move ${
                      selectedSectionId === section.id
                        ? "bg-indigo-500 text-white"
                        : "bg-white hover:bg-gray-100"
                    } rounded p-2`}
                  >
                    {editingSectionId === section.id ? (
                      <div className="flex gap-1 items-center">
                        <input
                          type="text"
                          value={editingSectionTitle}
                          onChange={(e) =>
                            setEditingSectionTitle(e.target.value)
                          }
                          className="flex-1 px-2 py-1 border rounded text-black text-sm min-w-0"
                          autoFocus
                        />
                        <button
                          onClick={() => saveSectionTitle(section.id)}
                          className="px-2 py-1 bg-indigo-500 text-white rounded text-xs hover:bg-indigo-600 transition-colors whitespace-nowrap"
                        >
                          💾
                        </button>
                        <button
                          onClick={() => setEditingSectionId(null)}
                          className="px-2 py-1 bg-slate-300 text-slate-700 rounded text-xs hover:bg-slate-400 transition-colors whitespace-nowrap"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => setSelectedSectionId(section.id)}
                        className="flex items-center justify-between"
                      >
                        <span>{section.title}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateSection(section);
                            }}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSection(section);
                            }}
                            className="px-2 py-1 text-xs rounded bg-rose-100 hover:bg-rose-200 text-rose-700 transition-colors"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

              {/* 중단원 추가 버튼 */}
              <button
                onClick={() => handleAddSection(chapter.id)}
                className="w-full px-3 py-2 bg-emerald-100 hover:bg-emerald-200 rounded text-sm text-emerald-700 transition-colors"
              >
                + 중단원 추가
              </button>
            </div>
          </div>
        ))}

        {/* 대단원 추가 버튼 */}
        <button
          onClick={handleAddChapter}
          className="w-full px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-semibold transition-colors shadow-sm"
        >
          + 대단원 추가
        </button>
      </div>

      {/* 오른쪽 패널: 문제 관리 */}
      <div className="flex-1 flex flex-col">
        {!selectedSectionId ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            왼쪽에서 중단원을 선택하세요
          </div>
        ) : (
          <>
            {/* 문제 번호 탭 */}
            <div className="border-b border-gray-300 p-4 bg-white flex gap-2 overflow-x-auto">
              {questions.map((q, index) => (
                <button
                  key={q.id}
                  onClick={() => {
                    setSelectedQuestionIndex(index);
                    setIsNewQuestion(false);
                  }}
                  className={`px-4 py-2 rounded whitespace-nowrap ${
                    !isNewQuestion && selectedQuestionIndex === index
                      ? "bg-indigo-500 text-white"
                      : "bg-gray-200 hover:bg-gray-300"
                  }`}
                >
                  {index + 1}
                </button>
              ))}
              <button
                onClick={() => setIsNewQuestion(true)}
                className={`px-4 py-2 rounded whitespace-nowrap ${
                  isNewQuestion
                    ? "bg-indigo-500 text-white"
                    : "bg-emerald-500 text-white hover:bg-emerald-600"
                }`}
              >
                +
              </button>
            </div>

            {/* 문제 입력 폼 - 좌우 분할 */}
            <div className="flex-1 overflow-y-auto flex pb-24">
              {/* 왼쪽: 입력 폼 */}
              <div className="w-1/2 p-6 border-r border-gray-300 overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">입력</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      문제 유형
                    </label>
                    <select
                      value={questionType}
                      onChange={(e) => {
                        setQuestionType(
                          e.target.value as "multiple_choice" | "short_answer"
                        );
                        if (e.target.value === "short_answer") {
                          setChoices(["", "", "", ""]);
                        }
                      }}
                      className="w-full px-4 py-2 border rounded"
                    >
                      <option value="multiple_choice">객관식</option>
                      <option value="short_answer">단답형</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium">
                        문제 텍스트
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentEditingField("question");
                          setShowLatexHelper(!showLatexHelper);
                        }}
                        className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors"
                      >
                        Σ
                      </button>
                    </div>
                    <textarea
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                      rows={6}
                      className="w-full px-4 py-2 border rounded"
                      placeholder="수식은 $...$ (인라인) 또는 $$...$$ (블록)으로 감싸세요"
                    />

                    {showLatexHelper && currentEditingField === "question" && (
                      <div className="mt-2 p-4 border rounded bg-purple-50">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-purple-900">
                            자주 사용하는 수식
                          </h4>
                          <button
                            onClick={() => setShowLatexHelper(false)}
                            className="text-xs text-purple-600 hover:text-purple-800"
                          >
                            ✕ 닫기
                          </button>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {latexTemplates.map((template, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => insertLatex(template.latex, false)}
                              className="px-3 py-2 text-sm bg-white hover:bg-purple-100 border border-purple-200 rounded text-left transition-colors"
                              title={`클릭하면 삽입: ${template.latex}`}
                            >
                              <div className="font-medium text-purple-900">
                                {template.preview}
                              </div>
                              <div className="text-xs text-gray-500">
                                {template.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {questionType === "multiple_choice" && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        선지
                      </label>
                      <div className="space-y-2">
                        {choices.map((choice, index) => (
                          <div key={index}>
                            <div className="flex gap-2 items-center">
                              <input
                                type="text"
                                value={choice}
                                onChange={(e) => {
                                  const newChoices = [...choices];
                                  newChoices[index] = e.target.value;
                                  setChoices(newChoices);
                                }}
                                placeholder={`선지 ${index + 1}`}
                                className="flex-1 px-4 py-2 border rounded"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setCurrentEditingField(
                                    `choice${index}` as any
                                  );
                                  setShowLatexHelper(!showLatexHelper);
                                }}
                                className="px-2 py-2 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors whitespace-nowrap"
                              >
                                Σ
                              </button>
                            </div>
                            {showLatexHelper &&
                              currentEditingField === `choice${index}` && (
                                <div className="mt-2 p-3 border rounded bg-purple-50">
                                  <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-xs font-semibold text-purple-900">
                                      자주 사용하는 수식
                                    </h4>
                                    <button
                                      onClick={() => setShowLatexHelper(false)}
                                      className="text-xs text-purple-600 hover:text-purple-800"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1 mb-2">
                                    {latexTemplates
                                      .slice(0, 12)
                                      .map((template, idx) => (
                                        <button
                                          key={idx}
                                          type="button"
                                          onClick={() =>
                                            insertLatex(template.latex, false)
                                          }
                                          className="px-2 py-1 text-xs bg-white hover:bg-purple-100 border border-purple-200 rounded text-center"
                                        >
                                          {template.preview}
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium">정답</label>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentEditingField("answer");
                          setShowLatexHelper(!showLatexHelper);
                        }}
                        className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors"
                      >
                        Σ
                      </button>
                    </div>
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder={
                        questionType === "multiple_choice"
                          ? "1, 2, 3, 4"
                          : "정답 (수식은 $...$ 또는 $$...$$ 또는 \\(...\\) 또는 \\[...\\]로 감싸세요)"
                      }
                      rows={3}
                      className="w-full px-4 py-2 border rounded resize-y"
                    />

                    {showLatexHelper && currentEditingField === "answer" && (
                      <div className="mt-2 p-3 border rounded bg-purple-50">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-semibold text-purple-900">
                            자주 사용하는 수식
                          </h4>
                          <button
                            onClick={() => setShowLatexHelper(false)}
                            className="text-xs text-purple-600 hover:text-purple-800"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {latexTemplates.slice(0, 12).map((template, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setAnswer(answer + `$${template.latex}$`);
                                setShowLatexHelper(false);
                              }}
                              className="px-2 py-1 text-xs bg-white hover:bg-purple-100 border border-purple-200 rounded text-center"
                            >
                              {template.preview}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium">해설</label>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentEditingField("explanation");
                          setShowLatexHelper(!showLatexHelper);
                        }}
                        className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded transition-colors"
                      >
                        Σ
                      </button>
                    </div>
                    <textarea
                      value={explanation}
                      onChange={(e) => setExplanation(e.target.value)}
                      rows={4}
                      className="w-full px-4 py-2 border rounded"
                      placeholder="수식은 $...$ (인라인) 또는 $$...$$ (블록)으로 감싸세요"
                    />

                    {showLatexHelper &&
                      currentEditingField === "explanation" && (
                        <div className="mt-2 p-4 border rounded bg-purple-50">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-purple-900">
                              자주 사용하는 수식
                            </h4>
                            <button
                              onClick={() => setShowLatexHelper(false)}
                              className="text-xs text-purple-600 hover:text-purple-800"
                            >
                              ✕ 닫기
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {latexTemplates.map((template, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() =>
                                  insertLatex(template.latex, false)
                                }
                                className="px-3 py-2 text-sm bg-white hover:bg-purple-100 border border-purple-200 rounded text-left transition-colors"
                              >
                                <div className="font-medium text-purple-900">
                                  {template.preview}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {template.name}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* 오른쪽: 미리보기 */}
              <div className="w-1/2 p-6 bg-gray-50 overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4">미리보기</h3>
                <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm">
                  <div>
                    <div className="text-sm font-medium text-gray-600 mb-2">
                      문제 유형:{" "}
                      {questionType === "multiple_choice" ? "객관식" : "단답형"}
                    </div>
                  </div>

                  {questionText && (
                    <div>
                      <div className="text-sm font-semibold text-gray-700 mb-2">
                        문제:
                      </div>
                      <div className="text-base">
                        <MathText text={questionText} />
                      </div>
                    </div>
                  )}

                  {questionType === "multiple_choice" &&
                    choices.some((c) => c.trim()) && (
                      <div>
                        <div className="text-sm font-semibold text-gray-700 mb-2">
                          선지:
                        </div>
                        <div className="space-y-2">
                          {choices.map(
                            (choice, index) =>
                              choice.trim() && (
                                <div
                                  key={index}
                                  className="flex items-start gap-2"
                                >
                                  <span className="font-medium">
                                    {index + 1}.
                                  </span>
                                  <div className="flex-1">
                                    <MathText text={choice} />
                                  </div>
                                </div>
                              )
                          )}
                        </div>
                      </div>
                    )}

                  {answer && (
                    <div>
                      <div className="text-sm font-semibold text-gray-700 mb-2">
                        정답:
                      </div>
                      <div className="text-base text-blue-600 font-medium">
                        <MathText text={answer} />
                      </div>
                    </div>
                  )}

                  {explanation && (
                    <div>
                      <div className="text-sm font-semibold text-gray-700 mb-2">
                        해설:
                      </div>
                      <div className="text-base">
                        <MathText text={explanation} />
                      </div>
                    </div>
                  )}

                  {!questionText &&
                    !choices.some((c) => c.trim()) &&
                    !answer &&
                    !explanation && (
                      <div className="text-gray-400 text-center py-8">
                        왼쪽에서 입력하면 여기에 미리보기가 표시됩니다
                      </div>
                    )}
                </div>
              </div>
            </div>

            {/* 하단 버튼 */}
            <div className="fixed bottom-0 right-0 left-80 border-t border-gray-300 p-4 bg-white flex gap-3 justify-center shadow-lg">
              {isNewQuestion ? (
                <button
                  onClick={handleSaveNewQuestion}
                  className="px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-semibold transition-colors shadow-sm hover:shadow-md"
                >
                  저장하기
                </button>
              ) : (
                <>
                  <button
                    onClick={handleDeleteQuestion}
                    className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 font-semibold transition-colors shadow-sm hover:shadow-md"
                  >
                    문제 삭제하기
                  </button>
                  <button
                    onClick={handleMoveQuestion}
                    className="px-6 py-3 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 font-semibold transition-colors shadow-sm hover:shadow-md"
                  >
                    문제 이동하기
                  </button>
                  <button
                    onClick={handleUpdateQuestion}
                    className="px-6 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-semibold transition-colors shadow-sm hover:shadow-md"
                  >
                    문제 수정하기
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


