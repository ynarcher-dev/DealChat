const LAMBDA_URL = 'https://fx4w4useafzrufeqxfqui6z5p40aazkb.lambda-url.ap-northeast-2.on.aws/';

const columnDefs = [
    { field: "id", headerName: "ID", sortable: true, filter: true, width: 100, hide: true },
    { field: "companyName", headerName: "매수자명", sortable: true, filter: true, flex: 1 },
    { field: "industry", headerName: "산업", sortable: true, filter: true, flex: 1 },
    { field: "summary", headerName: "요약", sortable: true, filter: true, flex: 2.5 }
];

const gridOptions = {
    columnDefs: columnDefs,
    rowModelType: 'infinite',
    cacheBlockSize: 100,
    maxConcurrentDatasourceRequests: 1,
    infiniteInitialRowCount: 1,
    theme: 'legacy',
    defaultColDef: {
        resizable: true,
        sortable: true,
        filter: true
    },
    pagination: true,
    paginationPageSize: 20,
    onRowClicked: (params) => {
        const id = params.data.id;
        if (id) {
            window.location.href = `./dealbook.html?id=${encodeURIComponent(id)}`;
        }
    }
};

let gridApi;

$(document).ready(function () {
    const gridDiv = document.querySelector('#buyerGrid');
    gridApi = agGrid.createGrid(gridDiv, gridOptions);

    const datasource = {
        getRows: (params) => {
            const keyword = ($('#search-input').val() || "").trim();

            fetch(LAMBDA_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    table: 'buyers', // Adjusted for buyers
                    keyword: keyword
                })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        console.error('Lambda Error:', data.error);
                        params.failCallback();
                        return;
                    }

                    const rows = Array.isArray(data) ? data : [];
                    params.successCallback(rows, rows.length);
                })
                .catch(error => {
                    console.error('Fetch Error:', error);
                    params.failCallback();
                });
        }
    };

    gridApi.setGridOption('datasource', datasource);

    $('#search-btn').on('click', () => {
        gridApi.setGridOption('datasource', datasource);
    });

    $('#search-input').on('keypress', (e) => {
        if (e.which === 13) {
            gridApi.setGridOption('datasource', datasource);
        }
    });

    $('.logo').on('click', () => {
        $('#search-input').val('');
        gridApi.setGridOption('datasource', datasource);
    });
});
