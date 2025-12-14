"use client";

import { InlineMath, BlockMath } from "react-katex";

export default function MathText({ text }: { text: string }) {
  // \(...\) 는 인라인 수식, \[...\] 는 블록 수식 (LaTeX 표준)
  // $...$ 는 인라인 수식, $$...$$ 는 블록 수식

  // 1) 모델이 "\\n" 또는 "\n" 같은 문자 그대로 보내는 경우가 있어, 실제 줄바꿈으로 변환
  // 주의: LaTeX 명령어(\times, \text 등)를 보호하기 위해 단어 경계를 확인
  let processedText = (text ?? "")
    // \\n을 줄바꿈으로 변환 (단, \\nolimits 같은 LaTeX 명령어가 아닌 경우만)
    .replace(/\\n(?![a-zA-Z])/g, "\n")
    // \\r 변환
    .replace(/\\r(?![a-zA-Z])/g, "\r");

  // 2) 먼저 \(...\) 와 \[...\] 를 $...$ 와 $$...$$ 로 변환
  processedText = processedText
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, g1) => `$${g1}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, g1) => `$$${g1}$$`);

  // 3) $가 없는 경우에만 자동 래핑
  if (!processedText.includes("$")) {
    // \text{}, \textit{}, \textbf{}, \textrm{} 등 텍스트 명령어 감지
    if (/\\text[a-z]*\{/.test(processedText)) {
      processedText = `$${processedText}$`;
    }
    // 숫자+\times+숫자 같은 패턴 (백슬래시 포함)
    else if (/(\d+)\s*\\(times|cdot|div|pm)\s*(\d+)/.test(processedText)) {
      processedText = `$${processedText}$`;
    }
    // 숫자+times+숫자 같은 패턴 (백슬래시 없음)
    else if (/(\d+)\s*(times|cdot|div|pm)\s*(\d+)/.test(processedText)) {
      processedText = processedText.replace(
        /(\d+)\s*(times|cdot|div|pm)\s*(\d+)/g,
        (match, n1, cmd, n2) => `$${n1}\\${cmd}${n2}$`
      );
    }
    // \frac, \sqrt 등 LaTeX 명령어 감지
    else if (/\\(frac|sqrt|sum|int|lim|infty|[a-z]+)\{/.test(processedText)) {
      processedText = `$${processedText}$`;
    }
    // x^2, 2x^{2} 같은 일반 수식 패턴
    else if (/[a-zA-Z0-9]+[\^_][\{\[]?[a-zA-Z0-9]/.test(processedText)) {
      const mathChunk =
        /([0-9A-Za-z+\-*/=(){}\[\].]+(?:\s*[0-9A-Za-z+\-*/=(){}\[\].]+)*?(?:\\[A-Za-z]+(?:\{[^}]+\})?|[0-9A-Za-z]+\^\{[^}]+\}|[0-9A-Za-z]+_\{[^}]+\}|[0-9A-Za-z]+\^[0-9A-Za-z]+|[0-9A-Za-z]+_[0-9A-Za-z]+)[0-9A-Za-z+\-*/=(){}\[\].]*)/g;

      processedText = processedText.replace(mathChunk, (m) => {
        if (m.startsWith("$")) return m;
        return `$${m}$`;
      });
    }
  }

  const parts = processedText.split(/(\$\$[\s\S]+?\$\$|\$[\s\S]+?\$)/g);

  return (
    <span
      style={{
        display: "inline",
        maxWidth: "100%",
        wordBreak: "break-word",
        overflowWrap: "break-word",
      }}
      className="math-text-wrapper"
    >
      {parts.map((part, i) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          return <BlockMath key={i} math={part.slice(2, -2)} />;
        } else if (part.startsWith("$") && part.endsWith("$")) {
          return (
            <span key={i} style={{ display: "inline-block", maxWidth: "100%" }}>
              <InlineMath math={part.slice(1, -1)} />
            </span>
          );
        } else {
          return (
            <span key={i} style={{ whiteSpace: "pre-wrap" }}>
              {part}
            </span>
          );
        }
      })}
    </span>
  );
}



