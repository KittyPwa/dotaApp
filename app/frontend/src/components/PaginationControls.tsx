type PaginationControlsProps = {
  page: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange?: (pageSize: number) => void;
};

export function PaginationControls({
  page,
  totalPages,
  totalItems,
  pageSize,
  pageSizeOptions,
  onPrevious,
  onNext,
  onPageSizeChange
}: PaginationControlsProps) {
  const startRow = totalItems && pageSize ? (page - 1) * pageSize + 1 : null;
  const endRow = totalItems && pageSize ? Math.min(page * pageSize, totalItems) : null;

  return (
    <div className="pagination-inline">
      {pageSize && pageSizeOptions && onPageSizeChange ? (
        <label className="pagination-page-size">
          Rows
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button type="button" onClick={onPrevious} disabled={page <= 1}>
        Prev
      </button>
      <span>
        Page {page} / {totalPages}
      </span>
      {startRow !== null && endRow !== null ? <span>Rows {startRow}-{endRow}</span> : null}
      <button type="button" onClick={onNext} disabled={page >= totalPages}>
        Next
      </button>
    </div>
  );
}
