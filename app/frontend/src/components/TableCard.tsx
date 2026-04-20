import type { ReactNode } from "react";
import { Card } from "./Card";
import { PaginationControls } from "./PaginationControls";

type TableCardProps = {
  title: string;
  children: ReactNode;
  empty?: ReactNode;
  rowCount: number;
  totalItems?: number;
  page: number;
  totalPages: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange?: (pageSize: number) => void;
  extra?: ReactNode;
};

export function TableCard({
  title,
  children,
  empty,
  rowCount,
  totalItems,
  page,
  totalPages,
  pageSize,
  pageSizeOptions,
  onPreviousPage,
  onNextPage,
  onPageSizeChange,
  extra
}: TableCardProps) {
  return (
    <Card title={title} extra={extra ? <div className="table-card-header-actions">{extra}</div> : null}>
      {rowCount > 0 ? (
        <div className="table-card-content">
          {children}
          <PaginationControls
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPrevious={onPreviousPage}
            onNext={onNextPage}
            onPageSizeChange={onPageSizeChange}
          />
        </div>
      ) : (
        empty
      )}
    </Card>
  );
}
