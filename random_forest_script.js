// APIエンドポイント
const API_BASE_URL = window.CONFIG?.API_URL || "https://14jsiwiija.execute-api.ap-northeast-1.amazonaws.com";

// HTMLから操作したい要素（ボタンや入力欄など）を取得して変数にまとめる
const elements = {
    fileInput: document.getElementById('csvFile'),              // ファイル選択ボタン
    encodingSelect: document.getElementById('encoding'),        // 文字コード選択
    hasHeaderCheck: document.getElementById('hasHeader'),       // ヘッダー有無のチェックボックス
    hasIndexCheck: document.getElementById('hasIndex'),         // インデックス有無のチェックボックス
    
    localPreviewBtn: document.getElementById('localPreviewBtn'),// Step 1のボタン
    regressionBtn: document.getElementById('regressionBtn'),    // Step 3の分析実行ボタン
    
    step2: document.getElementById('step2'),                    // プレビュー表示エリア全体
    step3: document.getElementById('step3'),                    // 実行ボタンエリア全体
    step4: document.getElementById('step4'),                    // 結果表示エリア全体
    
    localPreviewArea: document.getElementById('localPreviewArea'),// データの表を表示する場所
    variableSelectionArea: document.getElementById('variableSelectionArea'),// 変数を選ぶ場所
    resultArea: document.getElementById('resultArea'),          // 計算結果を表示する場所
    loader: document.getElementById('loader')                   // 「処理中...」の文字
};

// 読み込んだデータや設定を一時保存する変数
let currentCsvText = null;
let currentHasHeader = true;
let currentHasIndex = false;

// ファイルが選択されたらプレビューボタンを有効にする
elements.fileInput.addEventListener('change', () => {
    if (elements.fileInput.files.length > 0) {
        elements.localPreviewBtn.disabled = false;
    }    
});

// 「プレビュー表示」ボタンを押したときの処理
elements.localPreviewBtn.addEventListener('click', async () => {
    const file = elements.fileInput.files[0];
    if (!file) return; // ファイルが選ばれていなければ何もしない

    // サーバーの負担を減らすため、ファイルサイズが1MBを超えていたらエラーを出す
    if (file.size > 1024 * 1024) {
        alert("ファイルサイズが大きすぎます。1MB以下のファイルを選択してください。");
        return;
    }

    showLoader(true); // 「処理中...」を表示する
    try {
        // 画面で選択されている設定を取得する
        const encoding = elements.encodingSelect.value;
        currentHasHeader = elements.hasHeaderCheck.checked;
        currentHasIndex = elements.hasIndexCheck.checked;

        // 選ばれたファイルを、テキストデータとして読み込む
        currentCsvText = await fileToText(file, encoding);
        
        // APIに送る変数を作成する
        const payload = { 
            csv: currentCsvText, 
            hasHeader: currentHasHeader, 
            hasIndex: currentHasIndex 
        };
        
        // APIからプレビュー用のデータを取得する
        const result = await callApi('/api/preview', payload);
        
        // 返ってきたデータをもとに、画面に表と変数選択のチェックボックスを作る
        renderTable(JSON.parse(result.preview), elements.localPreviewArea);
        renderVariableSelection(result.columns);

        // Step 2のエリアを表示して、そこまで画面をスムーズにスクロールさせる
        elements.step2.style.display = 'block';
        elements.step2.scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
        // もしエラーが起きたらアラートで知らせる
        alert("エラーが発生しました: " + e.message);
    } finally {
        showLoader(false); // 成功しても失敗しても「処理中...」は消す
    }
});

// 「ランダムフォレストを実行」ボタンを押したときの処理
elements.regressionBtn.addEventListener('click', async () => {
    if (!currentCsvText) return;

    // ユーザーが選んだ目的変数と説明変数のリストを取得して検証する
    const selection = getSelectedVariables();
    if (!selection.target || selection.features.length === 0) {
        alert("目的変数と、少なくとも1つの説明変数を選択してください。");
        return;
    }

    // 分類か回帰か、どちらのラジオボタンが選ばれているか取得する
    const taskType = document.querySelector('input[name="taskType"]:checked').value;

    showLoader(true);
    elements.step4.style.display = 'none'; // 前の結果を消す

    try {
        // ランダムフォレスト用のAPIへ送る変数を作成する
        const payload = {
            csv: currentCsvText,
            target: selection.target,
            features: selection.features,
            hasHeader: currentHasHeader,
            hasIndex: currentHasIndex,
            task_type: taskType // 分類か回帰かも一緒に送る
        };
        
        // ランダムフォレスト用のAPIを呼ぶ
        const result = await callApi('/api/random_forest', payload);
        
        // 返ってきた分析結果を画面に表示する
        renderResult(result);
        
        // 結果エリアを表示して、スクロールする
        elements.step4.style.display = 'block';
        elements.step4.scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
        alert("分析中にエラーが発生しました: " + e.message);
        console.error(e); // 開発者ツールでエラーの原因を追えるようにログにも出しておく
    } finally {
        showLoader(false);
    }
});


// 関数
async function callApi(path, bodyObj) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj) // 送るデータをJSON文字列に変換する
    });

    const json = await response.json();

    // サーバーからエラー（400番台など）が返ってきたら、例外を投げる
    if (!response.ok) throw new Error(json.error || `サーバーエラー: ${response.status}`);
    return json;
}

// カラム名の一覧から、変数選択用のチェックボックスとラジオボタンを生成する関数
function renderVariableSelection(columns) {
    const container = elements.variableSelectionArea;
    container.innerHTML = ""; // 一旦中身を空にする

    const list = document.createElement('ul');
    list.className = 'variable-selection-list';

    // 見出し行を作成
    const headerLi = document.createElement('li');
    headerLi.innerHTML = `<strong>カラム名</strong> <span><span>説明変数(X)</span> / <span>目的変数(Y)</span></span>`;
    headerLi.style.background = '#eee';
    list.appendChild(headerLi);

    // カラムの数だけループして選択肢を作る
    columns.forEach((col, index) => {
        const li = document.createElement('li');
        
        // 説明変数を選ぶためのチェックボックス
        const xCheck = document.createElement('input');
        xCheck.type = 'checkbox';
        xCheck.name = 'feature';
        xCheck.value = col; 

        // 初期状態として、最後以外の列は説明変数にチェックを入れておく
        if (index < columns.length - 1) xCheck.checked = true;

        // 目的変数を選ぶためのラジオボタン（1つしか選べないようにする）
        const yRadio = document.createElement('input');
        yRadio.type = 'radio';
        yRadio.name = 'target';
        yRadio.value = col; 

        // 初期状態として、最後の列を目的変数として選択しておく
        if (index === columns.length - 1) yRadio.checked = true;

        // XとYが重複しないようにの排他処理
        xCheck.addEventListener('change', () => {
            if(xCheck.checked && yRadio.checked) {
                yRadio.checked = false;
            }
            checkStep3Ready(); // ボタンを押せるかチェック
        });
        yRadio.addEventListener('change', () => {
            if(yRadio.checked && xCheck.checked) {
                xCheck.checked = false;
            }
            checkStep3Ready(); // ボタンを押せるかチェック
        });

        // HTMLを組み立てる
        const label = document.createElement('label');
        label.textContent = col;

        const controls = document.createElement('div');
        controls.appendChild(xCheck);
        controls.appendChild(document.createTextNode(' X '));
        controls.appendChild(yRadio);
        controls.appendChild(document.createTextNode(' Y '));

        li.appendChild(label);
        li.appendChild(controls);
        list.appendChild(li);
    });

    container.appendChild(list);
    elements.step3.style.display = 'block'; // 変数選択ができたら、Step 3のボタンエリアを表示する
    checkStep3Ready();
}

// 現在チェックされている説明変数(X)と目的変数(Y)をまとめる関数
function getSelectedVariables() {
    const features = Array.from(document.querySelectorAll('input[name="feature"]:checked')).map(el => el.value);
    const targetEl = document.querySelector('input[name="target"]:checked');
    const target = targetEl ? targetEl.value : null;
    return { features, target };
}

// 実行ボタンを押せるかどうかを判定する関数
function checkStep3Ready() {
    const sel = getSelectedVariables();
    // 目的変数が1つ選ばれていて、説明変数が1つ以上選ばれていれば true
    const isValid = sel.target && sel.features.length > 0;
    elements.regressionBtn.disabled = !isValid;
}

// サーバーから返ってきた分析結果をHTMLに整形して表示する関数（ランダムフォレスト用）
function renderResult(data) {
    let html = ``;
    
    // 分類か回帰かで、評価の指標（正解率か決定係数か）を変える
    if (data.task_type === 'classification') {
        html += `<p><strong>モデルの正解率 (Accuracy):</strong> ${(data.metric_value * 100).toFixed(2)} %</p>`;
        html += `<p>予測対象クラス: ${data.classes.join(', ')}</p>`;
    } else {
        html += `<p><strong>決定係数 (R2 Score):</strong> ${data.metric_value.toFixed(4)}</p>`;
    }

    // 特徴量重要度（どのデータが予測に効いたか）を棒グラフで表示する
    html += `
        <h3>特徴量重要度 (Feature Importances)</h3>
        <p style="font-size: 0.9em; color: #7f8c8d;">※どの変数が予測に強く影響を与えたかを示します（合計で1.0になります）</p>
        <table>
            <thead><tr><th style="width: 40%">説明変数</th><th style="width: 20%">重要度</th><th style="width: 40%">割合(グラフ)</th></tr></thead>
            <tbody>
    `;
    
    // バックエンドから送られてきた重要度のデータをループして行を作る
    for (const [key, val] of Object.entries(data.importances)) {
        const percentage = (val * 100).toFixed(1); // ％に直す
        html += `
            <tr>
                <td>${key}</td>
                <td>${val.toFixed(4)}</td>
                <td>
                    <div style="font-size: 0.8em;">${percentage}%</div>
                    <div class="importance-bar-bg">
                        <div class="importance-bar-fill" style="width: ${percentage}%"></div>
                    </div>
                </td>
            </tr>
        `;
    }
    
    html += `</tbody></table>`;
    elements.resultArea.innerHTML = html;
}

// サーバーから返ってきた2次元配列データをHTMLのテーブルにする関数
function renderTable(dataObj, container) {
    let html = '<table><thead><tr>';
    dataObj.columns.forEach(c => html += `<th>${c}</th>`);
    html += '</tr></thead><tbody>';
    dataObj.data.forEach(row => {
        html += '<tr>';
        row.forEach(cell => html += `<td>${cell}</td>`);
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ファイルをブラウザ上で読み込んでテキストにする関数（Promiseを使って非同期処理にする）
function fileToText(file, encoding) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsText(file, encoding);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// ローディング（処理中...）の表示・非表示を切り替える関数
function showLoader(isLoading) {
    elements.loader.style.display = isLoading ? 'block' : 'none';
}