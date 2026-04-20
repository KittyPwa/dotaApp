import type { ReactNode } from "react";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  sortable?: boolean;
};

export type DataTableSortState = {
  key: string;
  direction: "asc" | "desc";
};

type DataTableProps<T> = {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  className?: string;
  sortState?: DataTableSortState;
  onSortChange?: (key: string) => void;
};

function getSortIndicator(active: boolean, direction: "asc" | "desc") {
  if (!active) return "";
  return direction === "asc" ? " ↑" : " ↓";
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  rowClassName,
  className,
  sortState,
  onSortChange
}: DataTableProps<T>) {
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>
              {column.sortable && onSortChange ? (
                <button type="button" className="table-sort-button" onClick={() => onSortChange(column.key)}>
                  {column.header}
                  {getSortIndicator(sortState?.key === column.key, sortState?.direction ?? "asc")}
                </button>
              ) : (
                column.header
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={getRowKey(row, index)} className={rowClassName?.(row, index)}>
            {columns.map((column) => (
              <td key={column.key}>{column.cell(row, index)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
