'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface Column<T> {
    key: string
    label: string
    sortable?: boolean
    render?: (item: T) => React.ReactNode
    className?: string
}

interface DataTableProps<T> {
    data: T[]
    columns: Column<T>[]
    searchable?: boolean
    searchPlaceholder?: string
    searchKeys?: (keyof T)[]
    pagination?: boolean
    pageSize?: number
    loading?: boolean
    emptyState?: React.ReactNode
    rowKey?: (item: T) => string | number
    onRowClick?: (item: T) => void
    className?: string
}

export function DataTable<T extends Record<string, any>>({
    data,
    columns,
    searchable = false,
    searchPlaceholder = 'Search...',
    searchKeys = [],
    pagination = true,
    pageSize = 10,
    loading = false,
    emptyState,
    rowKey = (item) => item.id,
    onRowClick,
    className
}: DataTableProps<T>) {
    const [searchQuery, setSearchQuery] = React.useState('')
    const [sortKey, setSortKey] = React.useState<string | null>(null)
    const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc')
    const [currentPage, setCurrentPage] = React.useState(1)

    // Filter data based on search
    const filteredData = React.useMemo(() => {
        if (!searchable || !searchQuery || searchKeys.length === 0) {
            return data
        }

        return data.filter((item) =>
            searchKeys.some((key) => {
                const value = item[key]
                if (value == null) return false
                return String(value).toLowerCase().includes(searchQuery.toLowerCase())
            })
        )
    }, [data, searchQuery, searchable, searchKeys])

    // Sort data
    const sortedData = React.useMemo(() => {
        if (!sortKey) return filteredData

        return [...filteredData].sort((a, b) => {
            const aVal = a[sortKey]
            const bVal = b[sortKey]

            if (aVal == null) return 1
            if (bVal == null) return -1

            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
            return sortDirection === 'asc' ? comparison : -comparison
        })
    }, [filteredData, sortKey, sortDirection])

    // Paginate data
    const paginatedData = React.useMemo(() => {
        if (!pagination) return sortedData

        const start = (currentPage - 1) * pageSize
        const end = start + pageSize
        return sortedData.slice(start, end)
    }, [sortedData, currentPage, pageSize, pagination])

    const totalPages = Math.ceil(sortedData.length / pageSize)

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
        } else {
            setSortKey(key)
            setSortDirection('asc')
        }
    }

    const handlePageChange = (page: number) => {
        setCurrentPage(Math.max(1, Math.min(page, totalPages)))
    }

    React.useEffect(() => {
        setCurrentPage(1)
    }, [searchQuery, sortKey, sortDirection])

    if (loading) {
        return (
            <div className={cn('space-y-4', className)}>
                {searchable && (
                    <div className="h-10 w-full max-w-sm animate-pulse rounded-md bg-muted" />
                )}
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
                    ))}
                </div>
            </div>
        )
    }

    if (!loading && data.length === 0 && emptyState) {
        return <div className={className}>{emptyState}</div>
    }

    return (
        <div className={cn('space-y-4', className)}>
            {searchable && (
                <div className="flex items-center gap-2">
                    <Input
                        placeholder={searchPlaceholder}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="max-w-sm"
                    />
                </div>
            )}

            <div className="rounded-md border">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                {columns.map((column) => (
                                    <th
                                        key={column.key}
                                        className={cn(
                                            'px-4 py-3 text-left text-sm font-medium',
                                            column.sortable && 'cursor-pointer select-none hover:bg-muted',
                                            column.className
                                        )}
                                        onClick={() => column.sortable && handleSort(column.key)}
                                    >
                                        <div className="flex items-center gap-2">
                                            {column.label}
                                            {column.sortable && (
                                                <span className="text-muted-foreground">
                                                    {sortKey === column.key ? (
                                                        sortDirection === 'asc' ? (
                                                            <ArrowUp className="size-4" />
                                                        ) : (
                                                            <ArrowDown className="size-4" />
                                                        )
                                                    ) : (
                                                        <ArrowUpDown className="size-4" />
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedData.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={columns.length}
                                        className="px-4 py-8 text-center text-sm text-muted-foreground"
                                    >
                                        No results found
                                    </td>
                                </tr>
                            ) : (
                                paginatedData.map((item) => (
                                    <tr
                                        key={rowKey(item)}
                                        className={cn(
                                            'border-b transition-colors hover:bg-muted/50',
                                            onRowClick && 'cursor-pointer'
                                        )}
                                        onClick={() => onRowClick?.(item)}
                                    >
                                        {columns.map((column) => (
                                            <td
                                                key={column.key}
                                                className={cn('px-4 py-3 text-sm', column.className)}
                                            >
                                                {column.render ? column.render(item) : item[column.key]}
                                            </td>
                                        ))}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {pagination && totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                        Showing {(currentPage - 1) * pageSize + 1} to{' '}
                        {Math.min(currentPage * pageSize, sortedData.length)} of{' '}
                        {sortedData.length} results
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(1)}
                            disabled={currentPage === 1}
                        >
                            <ChevronsLeft className="size-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft className="size-4" />
                        </Button>
                        <div className="text-sm">
                            Page {currentPage} of {totalPages}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                        >
                            <ChevronRight className="size-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePageChange(totalPages)}
                            disabled={currentPage === totalPages}
                        >
                            <ChevronsRight className="size-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
