import { useEffect, useState } from "react";

export function usePagination(totalItems: number, initialPageSize: number, pageSizeOptions?: number[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const sizes = pageSizeOptions && pageSizeOptions.length > 0 ? pageSizeOptions : [initialPageSize];
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    setPage((value) => Math.min(value, totalPages));
  }, [totalPages]);

  const paged = <T,>(items: T[]) => items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return {
    page: currentPage,
    pageSize,
    pageSizeOptions: sizes,
    totalPages,
    totalItems,
    setPage,
    setPageSize: (nextPageSize: number) => {
      setPageSizeState(nextPageSize);
      setPage(1);
    },
    previousPage: () => setPage((value) => Math.max(1, value - 1)),
    nextPage: () => setPage((value) => Math.min(totalPages, value + 1)),
    resetPage: () => setPage(1),
    paged
  };
}
