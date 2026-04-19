import type { ReactNode } from "react";
import { Card } from "./Card";
import { PaginationControls } from "./PaginationControls";

type TableCardProps = {
  title: string;
  children: ReactNode;
  empty?: ReactNode;
  rowCount: number;
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  extra?: ReactNode;
};

export function TableCard({
  title,
  children,
  empty,
  rowCount,
  page,
  totalPages,
  onPreviousPage,
  onNextPage,
  extra
}: TableCardProps) {
  return (
    <Card
      title={title}
      extra={
        <div className="table-card-header-actions">
          {extra}
          {rowCount > 0 ? (
            <PaginationControls page={page} totalPages={totalPages} onPrevious={onPreviousPage} onNext={onNextPage} />
          ) : null}
        </div>
      }
    >
      {rowCount > 0 ? children : empty}
    </Card>
  );
}
