"use client";
import { useState, useEffect, useMemo, useRef } from "react";
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
  rag_status?: "processing" | "completed" | "failed" | null;
}

export default function PDFPage() {
  // 폴더 및 PDF 상태
  const [folders, setFolders] = useState<Folder[]>([]);
  const [pdfs, setPdfs] = useState<PDF[]>([]);
  const [pdfsFolderId, setPdfsFolderId] = useState<string | null>(null);
  const [pdfsLoading, setPdfsLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<Folder | null>(null);
  const [selectedPdfUrl, setSelectedPdfUrl] = useState<string | null>(null);

  // PDF 뷰어 상태
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [fitToPage, setFitToPage] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [viewerSize, setViewerSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });

  // UI 상태
  const [newFolderName, setNewFolderName] = useState("");
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [pageInput, setPageInput] = useState("");

  // 폴더/PDF 편집 상태
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [draggedPdf, setDraggedPdf] = useState<PDF | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const selectedFolderIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedFolderIdRef.current = selectedFolder?.id ?? null;
  }, [selectedFolder]);

  // 초기 데이터 로드
  useEffect(() => {
    fetchFolders();
  }, []);

  // 폴더 선택 시 PDF 목록 로드
  useEffect(() => {
    if (selectedFolder) {
      // 폴더 전환 시 이전 폴더 PDF가 잠깐 보이는 현상 방지
      setPdfs([]);
      setPdfsFolderId(null);
      fetchPDFs(selectedFolder.id);
    }
  }, [selectedFolder]);

  // PDF 뷰어 영역 사이즈 추적 (화면 맞춤 계산용)
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      setViewerSize({
        w: Math.max(0, cr.width),
        h: Math.max(0, cr.height),
      });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedPdfUrl]);

  // 키보드 단축키
  useEffect(() => {
    if (!selectedPdfUrl) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + 확대/축소
      if ((e.ctrlKey || e.metaKey) && e.key === "+") {
        e.preventDefault();
        handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        handleFitToPage();
      }
      // 화살표 키로 페이지 이동
      else if (e.key === "ArrowLeft" && !e.target) {
        setPageNumber((prev) => Math.max(prev - 1, 1));
      } else if (e.key === "ArrowRight" && !e.target) {
        setPageNumber((prev) => Math.min(prev + 1, numPages || prev));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedPdfUrl, numPages, scale]);

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
    setPdfsLoading(true);
    try {
      const { data, error } = await supabase
        .from("pdfs")
        .select("*")
        .eq("folder_id", folderId)
        .order("created_at", { ascending: true });

      // 폴더를 바꾼 뒤 이전 요청이 늦게 도착해 UI가 깜빡이는 현상 방지
      if (selectedFolderIdRef.current !== folderId) return;

      if (!error && data) {
        setPdfs(data);
        setPdfsFolderId(folderId);
      } else {
        setPdfs([]);
        setPdfsFolderId(folderId);
      }
    } finally {
      if (selectedFolderIdRef.current === folderId) {
        setPdfsLoading(false);
      }
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

  const handleEditFolder = (folder: Folder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const handleSaveFolder = async (folderId: string) => {
    if (!editingFolderName.trim()) return;

    const { error } = await supabase
      .from("pdf_folders")
      .update({ name: editingFolderName })
      .eq("id", folderId);

    if (!error) {
      setEditingFolderId(null);
      setEditingFolderName("");
      await fetchFolders();
      // 현재 선택된 폴더가 편집된 폴더라면 업데이트
      if (selectedFolder?.id === folderId) {
        setSelectedFolder({ ...selectedFolder, name: editingFolderName });
      }
    } else {
      alert("폴더 이름 변경 실패: " + error.message);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!confirm("이 폴더와 포함된 모든 PDF를 삭제하시겠습니까?")) return;

    const { error } = await supabase
      .from("pdf_folders")
      .delete()
      .eq("id", folderId);

    if (!error) {
      await fetchFolders();
      // 삭제된 폴더가 선택된 폴더였다면 초기화
      if (selectedFolder?.id === folderId) {
        setSelectedFolder(null);
        setPdfs([]);
        setSelectedPdfUrl(null);
      }
    } else {
      alert("폴더 삭제 실패: " + error.message);
    }
  };

  const handleDeletePdf = async (pdfId: string, fileUrl: string) => {
    if (!confirm("이 PDF를 삭제하시겠습니까?")) return;

    try {
      // Storage에서 파일 삭제
      const pathMatch = fileUrl.match(/\/pdfs\/(.+)$/);
      if (pathMatch) {
        const filePath = pathMatch[1];
        await supabase.storage.from("pdfs").remove([filePath]);
      }

      // DB에서 삭제
      const { error } = await supabase.from("pdfs").delete().eq("id", pdfId);

      if (!error) {
        // PDF 목록 새로고침
        if (selectedFolder) {
          await fetchPDFs(selectedFolder.id);
        }
        // 삭제된 PDF가 현재 보고 있는 PDF라면 초기화
        if (selectedPdfUrl === fileUrl) {
          setSelectedPdfUrl(null);
          setPageNumber(1);
          setNumPages(null);
        }
      } else {
        alert("PDF 삭제 실패: " + error.message);
      }
    } catch (error: any) {
      alert("PDF 삭제 중 오류: " + error.message);
    }
  };

  const handleDragStart = (pdf: PDF) => {
    setDraggedPdf(pdf);
  };

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    setDragOverFolderId(folderId);
  };

  const handleDragLeave = () => {
    setDragOverFolderId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDragOverFolderId(null);

    if (!draggedPdf || draggedPdf.folder_id === targetFolderId) {
      setDraggedPdf(null);
      return;
    }

    // PDF를 다른 폴더로 이동
    const { error } = await supabase
      .from("pdfs")
      .update({ folder_id: targetFolderId })
      .eq("id", draggedPdf.id);

    if (!error) {
      // 현재 선택된 폴더의 PDF 목록 새로고침
      if (selectedFolder) {
        await fetchPDFs(selectedFolder.id);
      }
      alert("PDF가 이동되었습니다.");
    } else {
      alert("PDF 이동 실패: " + error.message);
    }

    setDraggedPdf(null);
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
    setUploadStatus("파일 업로드 중...");

    try {
      // 파일 확장자 추출
      const fileExt = file.name.split(".").pop();

      // UUID 생성 (간단한 방식)
      const generateUUID = () => {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      // UUID로 파일명 생성
      const fileName = `${generateUUID()}.${fileExt}`;
      // public 폴더 안에 업로드
      const filePath = `public/${fileName}`;

      console.log("Uploading to path:", filePath);
      console.log("Original filename:", file.name);

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

      // DB에 메타데이터 저장 (rag_status를 processing으로 설정)
      setUploadStatus("메타데이터 저장 중...");
      const { data: insertData, error: insertError } = await supabase
        .from("pdfs")
        .insert([
          {
            folder_id: selectedFolder.id,
            filename: file.name, // 원본 파일명
            file_url: publicUrl,
            rag_status: "processing", // processing으로 시작
          },
        ])
        .select();

      if (insertError) {
        console.error("Insert error:", insertError);
        throw insertError;
      }

      if (!insertData || insertData.length === 0) {
        throw new Error("PDF 메타데이터 저장 실패");
      }

      const insertedPdfId = insertData[0].id;
      console.log("Insert success:", insertData);

      // PDF 목록 갱신
      await fetchPDFs(selectedFolder.id);

      // 백그라운드에서 임베딩 시작
      setUploadStatus("임베딩 생성 중... (백그라운드)");

      // 임베딩 API 호출 (에러가 나도 업로드는 성공으로 처리)
      fetch("/api/embed-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfUrl: publicUrl,
          pdfId: insertedPdfId,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const errorData = await response.json();
            console.error("❌ 임베딩 실패:", errorData);
            // 실패 시 rag_status를 'failed'로 업데이트
            await supabase
              .from("pdfs")
              .update({ rag_status: "failed" })
              .eq("id", insertedPdfId);
            // PDF 목록 다시 갱신
            await fetchPDFs(selectedFolder.id);
          } else {
            const data = await response.json();
            console.log("✅ 임베딩 완료:", data);
            // 성공 시 PDF 목록 갱신 (rag_status가 'completed'로 변경됨)
            await fetchPDFs(selectedFolder.id);
          }
        })
        .catch((error) => {
          console.error("❌ 임베딩 API 호출 실패:", error);
        });

      alert("업로드 완료! 임베딩이 백그라운드에서 진행됩니다.");
      setUploadStatus("");
      e.target.value = ""; // input 초기화
    } catch (error: any) {
      console.error("Full error:", error);
      alert("업로드 실패: " + error.message);
      setUploadStatus("");
    } finally {
      setUploading(false);
    }
  };

  const handleFolderClick = (folder: Folder) => {
    setSelectedFolder(folder);
    setSelectedPdfUrl(null);
    setPageNumber(1);
    setNumPages(null);
    setPdfDoc(null);
    setPageSize(null);
    setRotation(0);
    setFitToPage(true);
    setPageInput("");
  };

  const handlePDFClick = (pdf: PDF) => {
    setSelectedPdfUrl(pdf.file_url);
    setPageNumber(1);
    setNumPages(null);
    setScale(1.0);
    setRotation(0);
    setPageInput("");
    setFitToPage(true);
  };

  const onDocumentLoadSuccess = (pdf: any) => {
    setNumPages(pdf?.numPages ?? null);
    setPdfDoc(pdf ?? null);
  };

  // 현재 페이지의 원본 크기 추출 (화면맞춤 계산용)
  const pageSizeReqId = useRef(0);
  useEffect(() => {
    if (!pdfDoc || !pageNumber) return;
    let cancelled = false;
    const reqId = ++pageSizeReqId.current;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || reqId !== pageSizeReqId.current) return;
        const viewport = page.getViewport({ scale: 1 });
        setPageSize({ w: viewport.width, h: viewport.height });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber]);

  const rotatedPageSize = useMemo(() => {
    if (!pageSize) return null;
    const r = ((rotation % 360) + 360) % 360;
    if (r === 90 || r === 270) return { w: pageSize.h, h: pageSize.w };
    return pageSize;
  }, [pageSize, rotation]);

  const fitScale = useMemo(() => {
    if (!rotatedPageSize) return null;
    // 스크롤이 "살짝" 생기는 것을 막기 위해 여유 마진을 둠
    const MARGIN = 0.98;
    const vw = Math.max(1, viewerSize.w);
    const vh = Math.max(1, viewerSize.h);
    const sw = vw / rotatedPageSize.w;
    const sh = vh / rotatedPageSize.h;
    const s = Math.min(sw, sh) * MARGIN;
    return Math.min(5, Math.max(0.1, s));
  }, [rotatedPageSize, viewerSize]);

  // 화면 맞춤 상태면 "현재 화면 기준"으로 스케일을 계속 갱신
  useEffect(() => {
    if (!fitToPage) return;
    if (!fitScale) return;
    setScale(fitScale);
  }, [fitToPage, fitScale]);

  const handleZoomIn = () => {
    // "현재 화면 기준 배율"에서 10% 확대
    setFitToPage(false);
    setScale((prev) => Math.min(prev * 1.1, 5));
  };

  const handleZoomOut = () => {
    // "현재 화면 기준 배율"에서 10% 축소
    setFitToPage(false);
    setScale((prev) => Math.max(prev * 0.9, 0.1));
  };

  const handleFitToPage = () => {
    setFitToPage(true);
    // scale은 fitScale 계산 useEffect에서 반영됨
  };

  const handleRotateLeft = () => {
    setRotation((prev) => (prev - 90) % 360);
  };

  const handleRotateRight = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handlePageJump = () => {
    const page = parseInt(pageInput);
    if (page && page >= 1 && numPages && page <= numPages) {
      setPageNumber(page);
      setPageInput("");
    }
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
              폴더 만들기
            </button>
          ) : (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAddFolder()}
                placeholder="폴더 이름"
                className="flex-1 min-w-0 px-2 py-2 border rounded text-sm"
                autoFocus
              />
              <button
                onClick={handleAddFolder}
                className="px-2.5 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex-shrink-0"
              >
                ✓
              </button>
              <button
                onClick={() => {
                  setIsAddingFolder(false);
                  setNewFolderName("");
                }}
                className="px-2.5 py-2 bg-gray-300 rounded hover:bg-gray-400 transition-colors flex-shrink-0"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 min-h-0 flex flex-col">
          {/* 폴더 및 PDF 목록 */}
          <div className="flex-1 space-y-2">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">폴더</h3>
            {folders.length === 0 ? (
              <p className="text-sm text-gray-400">폴더가 없습니다</p>
            ) : (
              folders.map((folder) => (
                <div
                  key={folder.id}
                  className="space-y-1"
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder.id)}
                >
                  {/* 폴더 버튼 */}
                  <div
                    className={`flex items-center gap-2 w-full px-4 py-2 rounded transition-colors ${
                      selectedFolder?.id === folder.id
                        ? "bg-blue-500 text-white"
                        : dragOverFolderId === folder.id
                        ? "bg-blue-200"
                        : "bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    {editingFolderId === folder.id ? (
                      <>
                        <input
                          type="text"
                          value={editingFolderName}
                          onChange={(e) => setEditingFolderName(e.target.value)}
                          onKeyPress={(e) =>
                            e.key === "Enter" && handleSaveFolder(folder.id)
                          }
                          className="flex-1 px-2 py-1 border rounded text-sm min-w-0"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveFolder(folder.id);
                          }}
                          className="px-2 py-1 bg-indigo-500 text-white rounded text-xs hover:bg-indigo-600 transition-colors whitespace-nowrap"
                        >
                          💾
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingFolderId(null);
                            setEditingFolderName("");
                          }}
                          className="px-2 py-1 bg-slate-300 text-slate-700 rounded text-xs hover:bg-slate-400 transition-colors whitespace-nowrap"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleFolderClick(folder)}
                          className="flex-1 text-left"
                        >
                          📁 {folder.name}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditFolder(folder);
                          }}
                          className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded text-slate-700 transition-colors flex-shrink-0"
                          title="이름 변경"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFolder(folder.id);
                          }}
                          className="px-2 py-1 text-xs bg-rose-100 hover:bg-rose-200 rounded text-rose-700 transition-colors flex-shrink-0"
                          title="삭제"
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>

                  {/* 해당 폴더가 선택되었을 때 PDF 목록 표시 */}
                  {selectedFolder?.id === folder.id && (
                    <div className="ml-4 space-y-1">
                      {pdfsLoading && pdfsFolderId !== folder.id ? (
                        <div className="text-xs text-gray-400 py-1.5">
                          불러오는 중...
                        </div>
                      ) : pdfsFolderId === folder.id && pdfs.length === 0 ? (
                        <div className="text-xs text-gray-400 py-1.5">
                          PDF가 없습니다
                        </div>
                      ) : pdfsFolderId === folder.id ? (
                        pdfs.map((pdf) => (
                          <div
                            key={pdf.id}
                            draggable
                            onDragStart={() => handleDragStart(pdf)}
                            className={`flex items-center gap-2 w-full px-3 py-1.5 rounded transition-colors text-sm cursor-move ${
                              selectedPdfUrl === pdf.file_url
                                ? "bg-indigo-500 text-white"
                                : "bg-gray-50 hover:bg-gray-100"
                            }`}
                          >
                            <button
                              onClick={() => handlePDFClick(pdf)}
                              className="flex-1 text-left flex items-center justify-between min-w-0"
                            >
                              <div className="truncate flex-1">
                                📄 {pdf.filename}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                                {pdf.rag_status === "processing" && (
                                  <span className="text-xs text-orange-600">
                                    처리중
                                  </span>
                                )}
                                {pdf.rag_status === "completed" && (
                                  <span className="text-xs text-green-600">
                                    ✓
                                  </span>
                                )}
                                {pdf.rag_status === "failed" && (
                                  <span className="text-xs text-red-600">
                                    ✗
                                  </span>
                                )}
                              </div>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePdf(pdf.id, pdf.file_url);
                              }}
                              className="px-2 py-1 text-xs bg-rose-100 hover:bg-rose-200 rounded text-rose-700 transition-colors flex-shrink-0"
                              title="삭제"
                            >
                              🗑️
                            </button>
                          </div>
                        ))
                      ) : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* PDF 업로드 버튼 - 맨 아래 고정 */}
          {selectedFolder && (
            <div className="mt-4 pt-4 border-t flex-shrink-0">
              <label
                className={`block w-full px-4 py-2 text-center rounded transition-colors cursor-pointer ${
                  uploading
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-green-500 text-white hover:bg-green-600"
                }`}
              >
                {uploading ? uploadStatus || "업로드 중..." : "📤 PDF 업로드"}
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
            {/* PDF 컨트롤 - 2줄 레이아웃 */}
            <div className="p-3 border-b bg-gray-50 flex-shrink-0">
              {/* 첫 번째 줄: 페이지 네비게이션 */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setPageNumber((prev) => Math.max(prev - 1, 1))}
                  disabled={pageNumber <= 1}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded disabled:bg-gray-300 hover:bg-blue-600 transition-colors text-sm"
                >
                  ← 이전
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handlePageJump()}
                    placeholder={String(pageNumber)}
                    className="w-16 px-2 py-1 border rounded text-center text-sm"
                    min="1"
                    max={numPages || undefined}
                  />
                  <span className="text-sm font-medium">
                    / {numPages || "..."}
                  </span>
                  <button
                    onClick={handlePageJump}
                    className="px-2 py-1 bg-gray-200 rounded hover:bg-gray-300 transition-colors text-sm"
                  >
                    이동
                  </button>
                </div>

                <button
                  onClick={() =>
                    setPageNumber((prev) =>
                      Math.min(prev + 1, numPages || prev)
                    )
                  }
                  disabled={!numPages || pageNumber >= numPages}
                  className="px-3 py-1.5 bg-blue-500 text-white rounded disabled:bg-gray-300 hover:bg-blue-600 transition-colors text-sm"
                >
                  다음 →
                </button>
              </div>

              {/* 두 번째 줄: 확대/축소 및 회전 컨트롤 */}
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handleZoomOut}
                  className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300 transition-colors text-sm"
                  title="축소 (Ctrl + -)"
                >
                  🔍−
                </button>

                <button
                  onClick={handleFitToPage}
                  className={`px-3 py-1.5 rounded transition-colors text-sm whitespace-nowrap ${
                    fitToPage
                      ? "bg-blue-500 text-white hover:bg-blue-600"
                      : "bg-gray-200 hover:bg-gray-300"
                  }`}
                  title="화면 맞춤 (Ctrl + 0)"
                >
                  화면 맞춤
                </button>

                <button
                  onClick={handleZoomIn}
                  className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300 transition-colors text-sm"
                  title="확대 (Ctrl + +)"
                >
                  🔍+
                </button>

                <div className="w-px h-6 bg-gray-300 mx-1"></div>

                <button
                  onClick={handleRotateLeft}
                  className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300 transition-colors text-sm"
                  title="왼쪽으로 90도 회전"
                >
                  왼쪽 90°
                </button>
                <button
                  onClick={handleRotateRight}
                  className="px-3 py-1.5 bg-gray-200 rounded hover:bg-gray-300 transition-colors text-sm"
                  title="오른쪽으로 90도 회전"
                >
                  오른쪽 90°
                </button>
              </div>
            </div>

            {/* PDF 표시 영역 */}
            <div
              ref={viewerRef}
              className={`flex-1 bg-gray-100 min-h-0 ${
                fitToPage ? "overflow-hidden" : "overflow-auto"
              }`}
            >
              <div className="w-full h-full p-2 flex items-start">
                {/*
                  w-max + mx-auto 조합:
                  - 페이지가 뷰포트보다 작으면 가운데 정렬
                  - 페이지가 뷰포트보다 크면 자동 margin이 0이 되어 왼쪽 기준으로 붙고, 스크롤 가능
                */}
                <div className="w-max mx-auto">
                  <Document
                    file={selectedPdfUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(error) =>
                      console.error("PDF 로드 에러:", error)
                    }
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
                      scale={scale}
                      rotate={rotation}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      className="shadow-lg"
                    />
                  </Document>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 오른쪽: 채팅 */}
      <div className="border rounded shadow overflow-hidden flex flex-col">
        {!selectedFolder ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-lg">폴더를 선택하세요</p>
              <p className="text-sm mt-2">
                폴더 내 PDF에 대해 질문할 수 있습니다
              </p>
            </div>
          </div>
        ) : (
          <ChatBox
            apiEndpoint="/api/chat-pdf"
            folderId={selectedFolder.id}
            isPdfChat={true}
          />
        )}
      </div>
    </div>
  );
}


