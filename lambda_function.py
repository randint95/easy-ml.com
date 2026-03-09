import json
import pandas as pd
import io
import traceback
import numpy as np

# データをきれいに揃える（標準化）ためのライブラリ
from sklearn.preprocessing import StandardScaler

# 重回帰分析用のライブラリ
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

# ロジスティック回帰分析（分類）用のライブラリ
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

# ランダムフォレスト（決定木の集合）用のライブラリ
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor


# AWS Lambdaが最初に呼び出す関数（メインの処理）
def lambda_handler(event, context):
    try:
        # 1. ユーザーから送られてきたデータ（リクエスト）を受け取る
        # どのURL（/api/previewなど）にアクセスされたかを取得
        api_path = event.get('rawPath') or event.get('path')
        
        # 送られてきたデータ（JSON）をPythonで扱える辞書型に変換
        body = json.loads(event.get('body', '{}'))
        csv_text = body.get('csv')
        
        # フロントエンドからの設定を取得
        has_header = body.get('hasHeader', True)
        has_index = body.get('hasIndex', False)
        standardize = body.get('standardize', False) # 標準化の有無（デフォルトはしない）

        # CSVデータが入っていなければエラーを返す
        if not csv_text:
            return create_response(400, {'error': "CSVデータが見つかりません。"})

        # サーバーがパンクしないように、約1MB（100万文字）以上なら弾く
        if len(csv_text) > 1_000_000: 
            return create_response(400, {'error': 'ファイルサイズが大きすぎます(サーバー制限: 約1MB)'})


        # 2. 共通処理: CSVのテキストデータをPandasで読み込む
        try:
            # テキストデータをファイルのように扱うための処理
            csv_file = io.StringIO(csv_text)
            
            # ユーザーの設定に合わせて読み込み方を変える
            header_opt = 0 if has_header else None
            index_opt = 0 if has_index else None
            
            # データ分析の基本ツール「pandas」のDataFrameに変換する
            df = pd.read_csv(csv_file, header=header_opt, index_col=index_opt)

            # ヘッダー（列名）がない場合は、適当な名前（列_1, 列_2...）をつける
            if not has_header:
                df.columns = [f"列_{i+1}" for i in range(len(df.columns))]

        except Exception as e:
            return create_response(400, {'error': f"CSVの読み込みに失敗しました: {str(e)}"})


        # 3. エンドポイント（URL）ごとの分岐処理
        # A. プレビュー用 API (/api/preview)
        # 最初の5行だけを返す
        if api_path == '/api/preview':
            columns = df.columns.tolist()
            preview_json = df.head().to_json(orient='split', index=False)
            return create_response(200, {'columns': columns, 'preview': preview_json})


        # B. 重回帰分析用 API (/api/regression)
        # 数値を予測する（例：売上の予測など）
        elif api_path == '/api/regression':
            target_col = body.get('target')      # 目的変数（Y）
            feature_cols = body.get('features')  # 説明変数（X）リスト
            
            if not target_col or not feature_cols:
                return create_response(400, {'error': "目的変数と説明変数を指定してください。"})

            try:
                # 必要な列だけを切り出し、空っぽ（欠損値）の行は消す
                df_selected = df[feature_cols + [target_col]].dropna()
            except KeyError as e:
                return create_response(400, {'error': f"指定された列が存在しません: {str(e)}"})

            if len(df_selected) < 2:
                return create_response(400, {'error': "有効なデータ行が少なすぎます。"})

            try:
                # 目的変数は「数値」じゃないと予測できないので変換を試みる
                y = pd.to_numeric(df_selected[target_col])
            except ValueError:
                return create_response(400, {'error': f"目的変数 '{target_col}' は数値データである必要があります。"})

            # 説明変数側の準備
            X_raw = df_selected[feature_cols]
            # 文字列データ（男/女など）が含まれていたら、自動で0と1のダミー変数に変換する
            X = pd.get_dummies(X_raw, drop_first=True, dtype=float)

            # 標準化オプションがONなら、データのスケールを揃える（平均0、分散1）
            if standardize:
                scaler = StandardScaler()
                X = pd.DataFrame(scaler.fit_transform(X), columns=X.columns, index=X.index)

            # 機械学習モデルの作成と学習（Fit）
            model = LinearRegression()
            model.fit(X, y)

            # 予測精度（R2スコア）の計算
            r2 = r2_score(y, model.predict(X))
            
            # 各変数の係数（重み）を辞書型にまとめる
            coeffs_dict = dict(zip(X.columns, model.coef_))

            # 計算結果をフロントエンドに返す
            return create_response(200, {
                'message': '重回帰分析完了',
                'target_column': target_col,
                'standardized': standardize,
                'r2_score': float(r2),
                'intercept': float(model.intercept_), # 切片
                'coefficients': coeffs_dict
            })


        # C. ロジスティック回帰分析用 API (/api/logistic)
        # 確率・分類を予測する（例：良品か不良品か）
        elif api_path == '/api/logistic':
            target_col = body.get('target')
            feature_cols = body.get('features')
            
            if not target_col or not feature_cols:
                return create_response(400, {'error': "変数を指定してください。"})

            try:
                df_selected = df[feature_cols + [target_col]].dropna()
            except KeyError as e:
                return create_response(400, {'error': f"列が存在しません: {str(e)}"})

            # 目的変数の種類が多すぎると分類できないのでチェックする
            unique_classes = df_selected[target_col].nunique()
            if unique_classes > 10:
                return create_response(400, {'error': f"目的変数 '{target_col}' の種類が多すぎます。"})
            elif unique_classes < 2:
                return create_response(400, {'error': "目的変数の種類が1つしかありません。最低2種類のデータが必要です。"})

            y = df_selected[target_col]
            X = pd.get_dummies(df_selected[feature_cols], drop_first=True, dtype=float)

            # 標準化処理
            if standardize:
                scaler = StandardScaler()
                X = pd.DataFrame(scaler.fit_transform(X), columns=X.columns, index=X.index)

            # ロジスティック回帰モデルの作成。収束しやすくするため max_iter を多めに設定
            model = LogisticRegression(max_iter=1000)
            model.fit(X, y)

            # 予測を行い、正解率（Accuracy）を計算する
            y_pred = model.predict(X)
            acc = accuracy_score(y, y_pred)
            
            # 係数の取得。2値分類の場合はリストの形が違うので調整している
            coef_array = model.coef_[0] if len(model.classes_) == 2 else model.coef_[0]
            coeffs_dict = dict(zip(X.columns, coef_array))

            return create_response(200, {
                'message': 'ロジスティック回帰分析完了',
                'target_column': target_col,
                'standardized': standardize,
                'classes': model.classes_.tolist(),
                'accuracy': float(acc),
                'coefficients': coeffs_dict
            })



        # D. ランダムフォレスト用 API (/api/random_forest)
        # 分類と回帰の両方ができる強力なアルゴリズム
        elif api_path == '/api/random_forest':
            target_col = body.get('target')
            feature_cols = body.get('features')
            task_type = body.get('task_type', 'classification') # classification(分類) または regression(回帰)
            
            if not target_col or not feature_cols:
                return create_response(400, {'error': "変数を指定してください。"})

            try:
                df_selected = df[feature_cols + [target_col]].dropna()
            except KeyError as e:
                return create_response(400, {'error': f"列が存在しません: {str(e)}"})

            if len(df_selected) < 2: 
                return create_response(400, {'error': "有効なデータ行が少なすぎます。"})

            y = df_selected[target_col]
            X = pd.get_dummies(df_selected[feature_cols], drop_first=True, dtype=float)


            # フロントエンドから送られてきたタスクタイプで処理を分岐
            if task_type == 'classification':
                # --- 分類タスクの場合 ---
                unique_classes = y.nunique()
                if unique_classes > 20:
                    return create_response(400, {'error': "目的変数の種類が多すぎます。数値予測の場合は「回帰」を選択してください。"})
                
                # 分類用のランダムフォレストモデルを作る（決定木の数は100本に設定）
                model = RandomForestClassifier(n_estimators=100, random_state=42)
                model.fit(X, y)
                metric_val = accuracy_score(y, model.predict(X)) # 評価は正解率
                classes_list = model.classes_.tolist()
            else:
                # --- 回帰タスクの場合 ---
                try:
                    y = pd.to_numeric(y)
                except ValueError:
                    return create_response(400, {'error': "目的変数が数値ではありません。"})
                
                # 回帰用のランダムフォレストモデルを作る
                model = RandomForestRegressor(n_estimators=100, random_state=42)
                model.fit(X, y)
                metric_val = r2_score(y, model.predict(X)) # 評価は決定係数
                classes_list = []

            # ランダムフォレストの強みである「特徴量重要度（Feature Importances）」を取得する
            importances = [float(v) for v in model.feature_importances_]
            importances_dict = dict(zip(X.columns, importances))
            
            # 重要度が高い順に並び替える
            sorted_importances = dict(sorted(importances_dict.items(), key=lambda item: item[1], reverse=True))

            return create_response(200, {
                'message': 'ランダムフォレスト分析完了',
                'task_type': task_type,
                'target_column': target_col,
                'classes': classes_list,
                'metric_value': float(metric_val),
                'importances': sorted_importances # 係数ではなく重要度を返す
            })

        # 指定されたURL以外にアクセスされた場合
        else:
            return create_response(404, {'error': f"パス {api_path} は存在しません"})

    except Exception as e:
        # 予期せぬエラーが起きたら、詳細なエラーメッセージを返す
        print(traceback.format_exc())
        return create_response(500, {'error': str(e), 'trace': traceback.format_exc()})


# CORS（別ドメインからのAPI呼び出し）を許可するためのレスポンスを作る共通関数
def create_response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'OPTIONS,POST'
        },
        'body': json.dumps(body, ensure_ascii=False) # 日本語が文字化けしないように ensure_ascii=False にする
    }