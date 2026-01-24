/**
 * PDF 파일에서 텍스트를 추출합니다.
 */
import { APIcall } from './APIcallFunction.js';
import { getEncoding } from "https://cdn.jsdelivr.net/npm/js-tiktoken@1.0.17/+esm";

const UPLOAD_URL = 'http://ai.yleminvest.com:5678/webhook/dealchat-upload';
// PDF.js 워커 설정
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';


export async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(" ") + "\n";
    }
    return text;
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
        alert("해당 파일 형식은 텍스트 추출을 지원하지 않습니다. 지원 가능한 포맷은 다음과 같습니다: PDF, DOCX, PPTX, TXT");
        return false;
    }
    return true;
}

export async function fileUpload(file, companyId = null, userId = null) {

    const formData = new FormData();
    formData.append('file', file);             // 바이너리 파일
    if (companyId) {
        formData.append('companyId', companyId);   // 회사 ID
    }
    if (userId) {
        formData.append('userId', userId);   // 사용자 ID
    }
    formData.append('fileName', file.name);    // 파일명

    const response = await APIcall(formData, UPLOAD_URL, {});
    return response;
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
