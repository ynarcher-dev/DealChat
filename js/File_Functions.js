import { APIcall } from './APIcallFunction.js';
import { getEncoding } from "https://cdn.jsdelivr.net/npm/js-tiktoken@1.0.17/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';



// 텍스트 품질 검증 함수 (외부 사용 가능하도록 export)
export const validateText = (text) => {
    if (!text) return { valid: false, msg: "텍스트를 추출할 수 없습니다. (빈 내용)" };
    const clean = text.trim();

    // 1. 최소 길이 체크 (50자 미만은 문맥 파악 불가로 판단)
    if (clean.length < 50) {
        return { valid: false, msg: `문서 내용이 너무 짧습니다. (현재 ${clean.length}자 / 최소 50자)\n의미 있는 검색을 위해 더 많은 내용이 필요합니다.` };
    }

    // 2. 인코딩 깨짐 감지 (깨진 문자 비율이 3% 이상이면 손상된 문서로 간주)
    const brokenChars = (clean.match(/\uFFFD/g) || []).length;
    if (brokenChars > 0 && (brokenChars / clean.length) > 0.03) {
        return { valid: false, msg: "문서 텍스트가 깨져있거나 인코딩 오류가 감지되었습니다.\n(올바른 PDF/문서 형식인지 확인해주세요)" };
    }

    // 3. 무의미한 반복 패턴 감지 (동일 문자 10회 이상 반복, 예: "..........")
    if (/(.)\1{9,}/.test(clean)) {
        return { valid: false, msg: "무의미한 반복 패턴이 감지되었습니다.\n(정상적인 텍스트 문서가 아닐 수 있습니다)" };
    }

    // 4. 정보 밀도 체크 (특수문자/공백 제외한 실제 언어 텍스트가 20자 미만)
    const meaningfulContent = clean.replace(/[^가-힣a-zA-Z0-9]/g, '');
    if (meaningfulContent.length < 20) {
        return { valid: false, msg: "유의미한 정보(한글/영문/숫자)가 너무 적습니다.\n(이미지 위주이거나 기호가 대부분인 문서입니다)" };
    }

    return { valid: true };
};

export async function extractTextFromPDF(file) {
    try {
        console.log('PDF extraction: Loading file...');
        const arrayBuffer = await file.arrayBuffer();
        console.log('PDF extraction: ArrayBuffer size:', arrayBuffer.byteLength);

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        console.log('PDF extraction: Document loaded, pages:', pdf.numPages);

        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(" ");
            console.log(`PDF extraction: Page ${i} text length:`, pageText.length);
            text += pageText + "\n";
        }
        console.log('PDF extraction: Total text length:', text.length);
        return text;
    } catch (error) {
        console.error('PDF extraction error:', error);
        throw error;
    }
}

/**
 * Word 파일(.docx)에서 텍스트를 추출합니다.
 */
export async function extractTextFromDocx(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
}

/**
 * PPTX 파일에서 텍스트를 추출합니다.
 */
export async function extractTextFromPptx(file) {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    let text = "";

    // 슬라이드 파일들 찾기 (ppt/slides/slide1.xml 등)
    const slideFiles = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));

    // 슬라이드 번호 순으로 정렬
    slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0]);
        const numB = parseInt(b.match(/\d+/)[0]);
        return numA - numB;
    });

    for (const fileName of slideFiles) {
        const content = await zip.file(fileName).async("string");
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(content, "application/xml");
        const textNodes = xmlDoc.getElementsByTagName("a:t");
        for (let i = 0; i < textNodes.length; i++) {
            text += textNodes[i].textContent + " ";
        }
        text += "\n";
    }
    return text;
}

/**
 * 텍스트 파일(.txt)에서 내용을 읽어옵니다.
 */
export async function extractTextFromTxt(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

export function filetypecheck(file) {
    const supportedTypes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain"
    ];

    if (!supportedTypes.includes(file.type)) {
        alert("현재 doc 파일은 지원하지 않으며, docx로 저장하여 업로드해야 합니다.");
        return false;
    }
    return true;
}


export async function fileUpload(file, userId = null, companyId = null, preExtractedText = null) {
    // 1. 텍스트 추출
    let extractedText = preExtractedText;

    // 미리 추출된 텍스트가 없으면 추출 시도
    if (!extractedText) {
        try {
            console.log('Starting text extraction for:', file.name, 'Type:', file.type);
            if (file.type === "application/pdf") {
                extractedText = await extractTextFromPDF(file);
            } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                extractedText = await extractTextFromDocx(file);
            } else if (file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
                extractedText = await extractTextFromPptx(file);
            } else if (file.type === "text/plain") {
                extractedText = await extractTextFromTxt(file);
            }
            console.log('Extracted text length:', extractedText.length);
            console.log('First 100 chars:', extractedText.substring(0, 100));

            // 텍스트 추출 실패 시 로그 출력 (기본 메시지 생성 안 함 -> 검증 실패 유도)
            if (!extractedText || extractedText.trim().length === 0) {
                console.warn('No text extracted from file');
            }
        } catch (err) {
            console.warn("Text extraction failed:", err);
            // 에러 발생 시 extractedText는 null/empty 상태 유지 -> 아래 검증에서 걸러짐
        }
    } else {
        console.log('Using pre-extracted text. Length:', extractedText.length);
    }

    // 2. 텍스트 품질 검증
    const validation = validateText(extractedText);
    if (!validation.valid) {
        const confirmMsg = `파일 업로드 불가: ${validation.msg}\n\n텍스트 추출에 실패했거나 내용이 충분하지 않은 문서입니다.`;
        alert(confirmMsg);
        throw new Error(validation.msg); // 업로드 중단
    }

    // 3. Base64 변환 및 업로드
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64Content = reader.result.split(',')[1];

            const fullText = extractedText.trim();
            const previewText = fullText.length > 1000 ? fullText.substring(0, 1000) + '...' : fullText;

            const payload = {
                table: 'files',
                action: 'upload',
                file_name: file.name,
                content: base64Content,
                is_base64: true,
                content_type: file.type || 'application/octet-stream',
                parsedText: fullText, // 검증된 텍스트
                summary: previewText, // 미리보기용 요약
                userId: userId,
                companyId: companyId,
                vectorNamespace: companyId
            };

            console.log('Upload payload:', {
                file_name: payload.file_name,
                parsedText_length: payload.parsedText.length,
                summary_length: payload.summary.length,
                summary_preview: payload.summary.substring(0, 50),
                companyId: payload.companyId,
                vectorNamespace: payload.vectorNamespace
            });

            try {
                const response = await APIcall(payload); // Defaults to Supabase endpoint
                resolve(response);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (error) => reject(new Error('파일 읽기 실패'));
    });
}

export async function fileDelete(fileId, fileName, userId, companyId = null) {
    const payload = {
        table: 'files',      // 추가
        action: 'delete',
        fileId: fileId,
        file_name: fileName,
        userId: userId,
        companyId: companyId // 선택 사항
    };

    try {
        const response = await APIcall(payload);
        return response;
    } catch (error) {
        throw error;
    }
}


export function countTokens(text) {
    if (!text) return 0;
    try {
        const enc = getEncoding("cl100k_base");
        const tokens = enc.encode(text);
        return tokens.length;
    } catch (e) {
        console.warn('tiktoken failed, falling back to heuristic:', e);
        return Math.ceil(text.length * 1.1);
    }
}

export function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
