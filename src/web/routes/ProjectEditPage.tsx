import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  PartSummary,
  ProjectDetail,
  ProjectWriteInput,
} from "@shared/types";
import { ProjectForm } from "../components/projects/ProjectForm";
import { Loading } from "../components/ui/Loading";
import { apiClient } from "../lib/api-client";

export function ProjectEditPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [parts, setParts] = useState<PartSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiClient.getProject(id),
      apiClient.listParts(
        new URLSearchParams({
          pageSize: "30",
          archived: "active",
          sort: "updatedAt",
          direction: "desc",
        }),
      ),
    ])
      .then(async ([projectData, partsResponse]) => {
        const loadedIds = new Set(partsResponse.items.map((part) => part.id));
        const missingParts = await Promise.all(
          projectData.parts
            .filter((part) => !loadedIds.has(part.partId))
            .map((part) => apiClient.getPart(part.partId)),
        );
        setProject(projectData);
        setParts([...partsResponse.items, ...missingParts]);
      })
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "データの読み込みに失敗しました。",
        ),
      );
  }, [id]);

  async function submit(input: ProjectWriteInput) {
    await apiClient.updateProject(id, input);
    navigate(`/projects/${id}`);
  }

  if (error) return <div className="p-4 text-app-danger">{error}</div>;
  if (!project) return <Loading />;
  return (
    <div className="grid gap-4">
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-semibold text-slate-950">
          プロジェクト編集
        </h1>
      </section>
      <ProjectForm parts={parts} initialProject={project} onSubmit={submit} />
    </div>
  );
}
