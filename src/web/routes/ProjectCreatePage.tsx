import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PartSummary, ProjectWriteInput } from "@shared/types";
import { ProjectForm } from "../components/projects/ProjectForm";
import { Loading } from "../components/ui/Loading";
import { apiClient } from "../lib/api-client";

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .listParts(new URLSearchParams({ pageSize: "200", archived: "all" }))
      .then(({ items }) => setParts(items))
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "データの読み込みに失敗しました。",
        ),
      )
      .finally(() => setIsLoading(false));
  }, []);

  async function submit(input: ProjectWriteInput) {
    const created = await apiClient.createProject(input);
    navigate(`/projects/${created.id}`);
  }

  if (isLoading) return <Loading />;
  if (error) return <div className="p-4 text-app-danger">{error}</div>;
  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-950">
          プロジェクト登録
        </h1>
      </section>
      <ProjectForm parts={parts} onSubmit={submit} />
    </div>
  );
}
