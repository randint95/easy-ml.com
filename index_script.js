
// HTMLの中の要素（ファイル入力欄など）を取得しておく
const fileInput = document.getElementById('csvFile');
const encodingSelect = document.getElementById('encoding');
const previewArea = document.getElementById('preview');

// ファイルが選択されたとき（changeイベント）に処理を実行する
fileInput.addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return; // キャンセルされた場合は何もしない

    // ユーザーが選んだ文字コード（UTF-8やShift-JIS）を取得
    const encoding = encodingSelect.value;

    // ブラウザ上でファイルを読み込むための FileReader を準備
    const reader = new FileReader();

    // 読み込みが完了したときの処理を定義
    reader.onload = function (event) {
        // ファイルのテキストデータを取得
        const text = event.target.result;

        // 改行コード（\n）で区切って、1行ずつの配列にする
        // ※ .trim() で最後にある余分な改行や空白を消しておく
        const lines = text.trim().split('\n');

        // 表（table）のHTMLを組み立てるための変数
        let tableHTML = "<table><thead><tr>";

        // 1行目（ヘッダー）をカンマで区切って、見出し(th)を作る
        const headers = lines[0].split(',');
        headers.forEach(header => tableHTML += `<th>${header}</th>`);
        tableHTML += "</tr></thead><tbody>";

        // 2行目以降のデータを表のセル(td)に入れていく
        // ※データが多すぎると重くなるので、Math.minを使って最大10行までに制限する
        const maxRows = Math.min(lines.length, 11);
        for (let i = 1; i < maxRows; i++) {
            const cells = lines[i].split(',');
            tableHTML += "<tr>";
            cells.forEach(cell => tableHTML += `<td>${cell}</td>`);
            tableHTML += "</tr>";
        }

        tableHTML += "</tbody></table>";

        // 組み立てたHTMLを画面に表示する
        previewArea.innerHTML = tableHTML;
    };

    // 指定した文字コードでファイルを読み込み開始
    reader.readAsText(file, encoding);
});

// もし文字コードを変更したときに、すでにファイルが選ばれていたら再描画する工夫
encodingSelect.addEventListener('change', function () {
    if (fileInput.files.length > 0) {
        // 強制的に change イベントを発生させて再読み込みする
        fileInput.dispatchEvent(new Event('change'));
    }
});
