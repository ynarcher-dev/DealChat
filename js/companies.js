const columnDefs = [
    { field: "company", headerName: "기업명", sortable: true, filter: true, flex: 2 },
    { field: "industry", headerName: "산업분야", sortable: true, filter: true, flex: 1.5 },
    { field: "stage", headerName: "투자단계", sortable: true, filter: true, flex: 1 },
    { field: "valuation", headerName: "기업가치", sortable: true, flex: 1.5 },
    { field: "location", headerName: "본사소재지", sortable: true, flex: 1.5 }
];

const rowData = [
    { company: "와이앤아처", industry: "엑셀러레이터", stage: "Late Stage", valuation: "500억", location: "서울특별시" },
    { company: "테크스타즈", industry: "AI 솔루션", stage: "Series A", valuation: "120억", location: "경기도 성남시" },
    { company: "에코모빌리티", industry: "모빌리티", stage: "Seed", valuation: "30억", location: "대구광역시" },
    { company: "바이오넥스트", industry: "헬스케어", stage: "Series B", valuation: "450억", location: "충청북도 오송" },
    { company: "핀테크랩", industry: "금융기술", stage: "Pre-A", valuation: "80억", location: "서울특별시" }
];

const gridOptions = {
    columnDefs: columnDefs,
    rowData: rowData,
    defaultColDef: {
        resizable: true,
        filter: true
    },
    pagination: true,
    paginationPageSize: 10
};

$(document).ready(function () {
    const gridDiv = document.querySelector('#companyGrid');
    new agGrid.Grid(gridDiv, gridOptions);
});
