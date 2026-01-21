const columnDefs = [
    { field: "name", headerName: "파일명", sortable: true, filter: true, flex: 2 },
    { field: "type", headerName: "유형", sortable: true, filter: true, flex: 1 },
    { field: "size", headerName: "크기", sortable: true, flex: 1 },
    { field: "date", headerName: "수정일", sortable: true, flex: 1 }
];

const rowData = [
    { name: "프로젝트 개요.pdf", type: "PDF", size: "1.2 MB", date: "2024-01-20" },
    { name: "시장 조사 보고서.docx", type: "Docx", size: "850 KB", date: "2024-01-18" },
    { name: "경쟁사 분석.xlsx", type: "Excel", size: "2.5 MB", date: "2024-01-21" },
    { name: "투자 계약서_초안.pdf", type: "PDF", size: "3.1 MB", date: "2024-01-15" }
];

const gridOptions = {
    columnDefs: columnDefs,
    rowData: rowData,
    defaultColDef: {
        resizable: true,
    },
    pagination: true,
    paginationPageSize: 10
};

$(document).ready(function () {
    const gridDiv = document.querySelector('#fileGrid');
    new agGrid.Grid(gridDiv, gridOptions);
});
