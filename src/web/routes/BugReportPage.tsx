import { useState, type FormEvent } from "react";
import { ApiError, apiClient, type BugReportInput } from "../lib/api-client";

const initialInput: BugReportInput = {
  title: "",
  description: "",
  stepsToReproduce: "",
  expectedBehavior: "",
  actualBehavior: "",
  severity: "normal",
};

export function BugReportPage() {
  const [input, setInput] = useState<BugReportInput>(initialInput);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ issueUrl: string | null; syncStatus: string } | null>(null);

  function update<K extends keyof BugReportInput>(key: K, value: BugReportInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    try {
      setIsSubmitting(true);
      const report = await apiClient.createBugReport(input);
      setInput(initialInput);
      setResult({ issueUrl: report.githubIssueUrl ?? null, syncStatus: report.githubSyncStatus });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "不具合報告の送信に失敗しました。時間をおいて再試行してください。");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="grid gap-4">
        <section className="panel-card grid gap-3 p-5">
          <h1 className="text-xl font-semibold text-slate-950">不具合を報告</h1>
          <div className="rounded-md bg-app-soft p-4 text-sm text-app-link">
            {result.syncStatus === "created" ? "GitHub Issueを作成し、担当者へ通知しました。" : "報告を受け付けました。GitHubへの連携は管理者が確認します。"}
          </div>
          {result.issueUrl && (
            <a className="btn btn-primary justify-self-start" href={result.issueUrl} target="_blank" rel="noreferrer">
              GitHub Issueを開く
            </a>
          )}
          <button className="btn justify-self-start" onClick={() => setResult(null)}>続けて報告する</button>
        </section>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="panel-card p-4">
        <h1 className="text-xl font-semibold text-slate-950">不具合を報告</h1>
        <p className="mt-1 text-sm text-slate-600">内容はGitHub Issueとして登録されます。再現手順を具体的に書いてもらえると、修正しやすくなります。</p>
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">パスワード、APIキー、個人情報、購入情報などの秘密は入力しないでください。報告内容はGitHub Issueに転記されます。</p>
      </section>

      <form className="panel-card grid max-w-3xl gap-4 p-4" onSubmit={submit}>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          件名 <span className="text-app-danger">*</span>
          <input
            required
            minLength={5}
            maxLength={160}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="例: 部品一覧を検索すると表示が崩れる"
            value={input.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          概要 <span className="text-app-danger">*</span>
          <textarea
            required
            minLength={10}
            maxLength={5000}
            rows={4}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="どの画面で、何が起きたかを書いてください。"
            value={input.description}
            onChange={(event) => update("description", event.target.value)}
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          再現手順
          <textarea
            maxLength={4000}
            rows={4}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder={"1. 部品一覧を開く\n2. 検索欄に…を入力\n3. …になる"}
            value={input.stepsToReproduce}
            onChange={(event) => update("stepsToReproduce", event.target.value)}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            期待する動作
            <textarea
              maxLength={2000}
              rows={3}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={input.expectedBehavior}
              onChange={(event) => update("expectedBehavior", event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            実際の動作
            <textarea
              maxLength={2000}
              rows={3}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={input.actualBehavior}
              onChange={(event) => update("actualBehavior", event.target.value)}
            />
          </label>
        </div>

        <label className="grid max-w-xs gap-1 text-sm font-medium text-slate-700">
          重要度
          <select className="rounded border border-slate-300 px-3 py-2 text-sm" value={input.severity} onChange={(event) => update("severity", event.target.value as BugReportInput["severity"])}>
            <option value="low">低: 代替手段あり</option>
            <option value="normal">通常</option>
            <option value="high">高: 主要機能に影響</option>
            <option value="critical">緊急: 利用できない・データに影響</option>
          </select>
        </label>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="btn btn-primary justify-self-start" disabled={isSubmitting}>
          {isSubmitting ? "送信中…" : "GitHubへ不具合を送信"}
        </button>
      </form>
    </div>
  );
}
