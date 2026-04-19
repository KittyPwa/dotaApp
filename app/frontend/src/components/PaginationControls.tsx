type PaginationControlsProps = {
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
};

export function PaginationControls({ page, totalPages, onPrevious, onNext }: PaginationControlsProps) {
  return (
    <div className="pagination-inline">
      <button type="button" onClick={onPrevious} disabled={page <= 1}>
        Prev
      </button>
      <span>
        Page {page} / {totalPages}
      </span>
      <button type="button" onClick={onNext} disabled={page >= totalPages}>
        Next
      </button>
    </div>
  );
}
