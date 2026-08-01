import Link from "next/link.js";

import type { CourseCardModel } from "../server/dashboard-view.ts";
import { LocalDate } from "./copy-command.tsx";
import { Badge, Card, ProgressBar } from "./ui/primitives.tsx";

export function CourseCard({ card }: { card: CourseCardModel }) {
  return (
    <Card className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="h-1.5 w-12 radius-sm"
        style={{ background: `var(--course-accent-${card.accentIndex})` }}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="m-0 min-w-0 text-base font-bold break-words">
          <Link href={card.href} className="tap-target inline-flex items-center no-underline hover:underline">{card.title}</Link>
        </h3>
        <Badge tone={card.status === "active" ? "accent" : "muted"}>{card.statusLabel}</Badge>
      </div>
      <p className="m-0 text-sm text-muted-foreground break-words line-clamp-3">{card.goal}</p>
      {card.dayLabel || card.stageLabel ? (
        <p className="m-0 text-sm font-semibold">
          {[card.dayLabel, card.stageLabel].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {card.note ? <p className="m-0 text-sm">{card.note}</p> : null}
      {card.progress ? <ProgressBar {...card.progress} label={`${card.title} 진도`} /> : null}
      <p className="m-0 text-xs text-muted-foreground">
        마지막 저장 <LocalDate iso={card.updatedAt} />
      </p>
    </Card>
  );
}
