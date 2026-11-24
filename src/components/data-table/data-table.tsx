"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type PaginationState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The application's data table (TanStack Table v9). Feature code describes columns with this small
 * API and never touches TanStack directly:
 *  - client-side sorting (columns with `sortValue`), pagination (`pageSize`),
 *  - search/filtering is done by the caller on `data` (keeps filter state with the page).
 */
export interface DataColumn<T extends RowData> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
  headerClassName?: string;
  align?: "left" | "right" | "center";
  /** Hide below the `md` breakpoint (secondary information). */
  hideOnMobile?: boolean;
}

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});

export function DataTable<T extends RowData>({
  data,
  columns,
  getRowId,
  pageSize = 25,
  initialSort,
  caption,
  onRowClick,
  rowClassName,
  empty,
  dense,
}: {
  data: readonly T[];
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
  pageSize?: number;
  initialSort?: { id: string; desc?: boolean };
  /** Accessible table caption (visually hidden). */
  caption: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Rendered instead of the body when `data` is empty. */
  empty?: ReactNode;
  dense?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [{ id: initialSort.id, desc: Boolean(initialSort.desc) }] : []);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });

  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return helper.columns(
      columns.map((column) =>
      helper.accessor((row: T) => (column.sortValue ? (column.sortValue(row) ?? "") : ""), {
        id: column.id,
        header: () => column.header,
        cell: (info) => column.cell(info.row.original),
        enableSorting: Boolean(column.sortValue),
        sortFn: "alphanumeric",
      }),
      ),
    );
  }, [columns]);

  const rows = useMemo(() => [...data], [data]);

  const table = useTable({
    features,
    columns: tableColumns,
    data: rows,
    getRowId: (row: T) => getRowId(row),
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: true,
  });

  const meta = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const pageRows = table.getRowModel().rows;
  const pageCount = table.getPageCount();
  const total = data.length;
  const start = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const end = Math.min(total, (pagination.pageIndex + 1) * pagination.pageSize);

  return (
    <div className="overflow-hidden rounded-xl border bg-surface shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-subtle">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b">
                {group.headers.map((header) => {
                  const column = meta.get(header.column.id);
                  const sorted = header.column.getIsSorted();
                  const sortable = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : sortable ? "none" : undefined}
                      className={cn(
                        "h-11 px-3 text-left align-middle text-xs font-semibold whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5",
                        column?.align === "right" && "text-right",
                        column?.align === "center" && "text-center",
                        column?.hideOnMobile && "hidden md:table-cell",
                        column?.headerClassName,
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground", column?.align === "right" && "flex-row-reverse")}
                        >
                          <table.FlexRender header={header} />
                          {sorted === "asc" ? <ArrowUp className="size-3" aria-hidden /> : sorted === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-4">
                  {empty ?? <p className="py-6 text-center text-sm text-muted-foreground">Nothing to show.</p>}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn("border-b transition-colors last:border-b-0 hover:bg-primary-soft/40", onRowClick && "cursor-pointer", rowClassName?.(row.original))}
                >
                  {row.getAllCells().map((cell) => {
                    const column = meta.get(cell.column.id);
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 align-middle first:pl-5 last:pr-5",
                          dense ? "py-2.5" : "py-3.5",
                          column?.align === "right" && "text-right",
                          column?.align === "center" && "text-center",
                          column?.hideOnMobile && "hidden md:table-cell",
                          column?.className,
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {total > pagination.pageSize ? (
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="tabular">
            {start}–{end} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <span className="tabular px-1">
              Page {pagination.pageIndex + 1} of {pageCount}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
