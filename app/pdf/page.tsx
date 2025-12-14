"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import ChatBox from "@/components/ChatBox";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// PDF.js worker 설정
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface Folder {
  id: string;
  name: string;
  created_at: string;
}

interface PDF {
  id: string;
  folder_id: string;
  filename: string;
  file_url: string;
  created_at: string;
}

export default function PDFPage() {
  // 폴더 및 PDF 상태
  const [folders, setFolders] = useState<Folder[]>([]);
  const [pdfs, setPdfs] = useState<PDF[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [selectedPdfUrl, setSelectedPdfUrl] = useState<string | null>(null);

  // PDF 뷰어 상태
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);

  // UI 상태
  const [newFolderName, setNewFolderName] = useState("");
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 초기 데이터 로드
  useEffect(() => {
    fetchFolders();
  }, []);

  // 폴더 선택 시 PDF 목록 로드
  useEffect(() => {
    if (selectedFolder) {
      fetchPDFs(selectedFolder.id);
    }
  }, [selectedFolder]);

  const fetchFolders = async () => {
    const { data, error } = await supabase
      .from("pdf_folders")
      .select("*")
      .order("created_at", { ascending: true });

    if (!error && data) {
      setFolders(data);
    }
  };

  const fetchPDFs = async (folderId: string) => {
    const { data, error } = await supabase
      .from("pdfs")
      .select("*")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setPdfs(data);
    }
  };

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) return;

    const { error } = await supabase
      .from("pdf_folders")
      .insert([{ name: newFolderName }]);

    if (!error) {
      setNewFolderName("");
      setIsAddingFolder(false);
      await fetchFolders();
    } else {
      alert("폴더 생성 실패: " + error.message);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedFolder) {
      alert("먼저 폴더를 선택하세요.");
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("PDF 파일만 업로드 가능합니다.");
      return;
    }

    setUploading(true);

    try {
      // 파일명 생성 (타임스탬프 + 원본 파일명)
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const filePath = `${selectedFolder.id}/${fileName}`;

      console.log("Uploading to path:", filePath);

      // Supabase Storage에 업로드
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("pdfs")
        .upload(filePath, file);

      if (uploadError) {
        console.error("Upload error:", uploadError);
        throw uploadError;
      }

      console.log("Upload success:", uploadData);

      // 공개 URL 가져오기
      const {
        data: { publicUrl },
      } = supabase.storage.from("pdfs").getPublicUrl(filePath);

      console.log("Public URL:", publicUrl);

      // DB에 메타데이터 저장 (rag_status 추가)
      const { data: insertData, error: insertError } = await supabase
        .from("pdfs")
        .insert([
          {
            folder_id: selectedFolder.id,
            filename: file.name,
            file_url: publicUrl,
            rag_status: "pending", // 기본값 추가
          },
        ])
        .select();

      if (insertError) {
        console.error("Insert error:", insertError);
        throw insertError;
      }

      console.log("Insert success:", insertData);

      alert("업로드 완료!");
      await fetchPDFs(selectedFolder.id);
      e.target.value = ""; // input 초기화
    } catch (error: any) {
      console.error("Full error:", error);
      alert("업로드 실패: " + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handlePDFClick = (pdf: PDF) => {
    setSelectedPdfUrl(pdf.file_url);
    setPageNumber(1);
    setNumPages(null);
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  return (
    <div className="grid grid-cols-[300px_1fr_400px] gap-4 h-full min-h-0 p-4 overflow-hidden">
      {/* 왼쪽: 폴더/PDF 목록 */}
      <div className="border rounded shadow bg-white overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-gray-50 flex-shrink-0">
          <h2 className="text-lg font-bold mb-3">PDF 관리</h2>

          {/* 폴더 추가 */}
          {!isAddingFolder ? (
            <button
              onClick={() => setIsAddingFolder(true)}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              + 폴더 추가
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAddFolder()}
                placeholder="폴더 이름"
                className="flex-1 px-3 py-2 border rounded"
                autoFocus
              />
              <button
                onClick={handleAddFolder}
                className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
              >
                ✓
              </button>
              <button
                onClick={() => {
                  setIsAddingFolder(false);
                  setNewFolderName("");
                }}
                className="px-3 py-2 bg-gray-300 rounded hover:bg-gray-400 transition-colors"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {/* 폴더 목록 */}
          <div className="space-y-2 mb-4">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">폴더</h3>
            {folders.length === 0 ? (
              <p className="text-sm text-gray-400">폴더가 없습니다</p>
            ) : (
              folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setSelectedFolder(folder)}
                  className={`w-full text-left px-4 py-2 rounded transition-colors ${
                    selectedFolder?.id === folder.id
                      ? "bg-blue-500 text-white"
                      : "bg-gray-100 hover:bg-gray-200"
                  }`}
                >
                  📁 {folder.name}
                </button>
              ))
            )}
          </div>

          {/* PDF 업로드 버튼 */}
          {selectedFolder && (
            <div className="mb-4">
              <label
                className={`block w-full px-4 py-2 text-center rounded transition-colors cursor-pointer ${
                  uploading
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-green-500 text-white hover:bg-green-600"
                }`}
              >
                {uploading ? "업로드 중..." : "📤 PDF 업로드"}
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileUpload}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {/* PDF 목록 */}
          {selectedFolder && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-600 mb-2">
                PDF 파일
              </h3>
              {pdfs.length === 0 ? (
                <p className="text-sm text-gray-400">PDF가 없습니다</p>
              ) : (
                pdfs.map((pdf) => (
                  <button
                    key={pdf.id}
                    onClick={() => handlePDFClick(pdf)}
                    className={`w-full text-left px-4 py-2 rounded transition-colors ${
                      selectedPdfUrl === pdf.file_url
                        ? "bg-indigo-500 text-white"
                        : "bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    <div className="text-sm font-medium truncate">
                      📄 {pdf.filename}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 중간: PDF 뷰어 */}
      <div className="border rounded shadow bg-white overflow-hidden flex flex-col">
        {!selectedPdfUrl ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-6xl mb-4">📄</div>
              <p className="text-lg">PDF를 선택하세요</p>
            </div>
          </div>
        ) : (
          <>
            {/* PDF 컨트롤 */}
            <div className="p-4 border-b bg-gray-50 flex items-center justify-between flex-shrink-0">
              <button
                onClick={() => setPageNumber((prev) => Math.max(prev - 1, 1))}
                disabled={pageNumber <= 1}
                className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300 hover:bg-blue-600 transition-colors"
              >
                ← 이전
              </button>

              <div className="text-sm font-medium">
                {numPages ? (
                  <>
                    페이지 {pageNumber} / {numPages}
                  </>
                ) : (
                  "로딩 중..."
                )}
              </div>

              <button
                onClick={() =>
                  setPageNumber((prev) => Math.min(prev + 1, numPages || prev))
                }
                disabled={!numPages || pageNumber >= numPages}
                className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300 hover:bg-blue-600 transition-colors"
              >
                다음 →
              </button>
            </div>

            {/* PDF 표시 영역 */}
            <div className="flex-1 overflow-y-auto bg-gray-100 flex justify-center p-4 min-h-0">
              <Document
                file={selectedPdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={(error) => console.error("PDF 로드 에러:", error)}
                loading={
                  <div className="text-center py-8">
                    <div className="text-gray-500">PDF 로딩 중...</div>
                  </div>
                }
                error={
                  <div className="text-center py-8">
                    <div className="text-red-500">
                      PDF를 불러올 수 없습니다.
                    </div>
                  </div>
                }
              >
                <Page
                  pageNumber={pageNumber}
                  renderTextLayer={true}
                  renderAnnotationLayer={true}
                  className="shadow-lg"
                />
              </Document>
            </div>
          </>
        )}
      </div>

      {/* 오른쪽: 채팅 */}
      <div className="border rounded shadow overflow-hidden flex flex-col">
        <ChatBox />
      </div>
    </div>
  );
}
