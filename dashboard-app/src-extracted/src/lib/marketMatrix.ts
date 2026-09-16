import type { MarketColumn, MarketModel, MarketRow, Selection } from "@/types/gatilho";

function cellIsOpen(cell: Selection | null | undefined) {
  return Boolean(cell && ["open", "selected", "odds_changed"].includes(cell.status));
}

function alignRow(
  row: MarketRow,
  sourceColumns: MarketColumn[],
  targetColumns: MarketColumn[],
): MarketRow {
  const sourceIndexByKey = new Map(sourceColumns.map((column, index) => [column.key, index]));
  return {
    ...row,
    cells: targetColumns.map((column) => {
      const sourceIndex = sourceIndexByKey.get(column.key);
      return sourceIndex === undefined ? null : row.cells[sourceIndex] ?? null;
    }),
  };
}

function mergeRows(current: MarketRow, incoming: MarketRow): MarketRow {
  return {
    ...current,
    playerName: incoming.playerName || current.playerName,
    teamId: incoming.teamId || current.teamId,
    teamName: incoming.teamName || current.teamName,
    cells: current.cells.map((cell, index) => {
      const next = incoming.cells[index] ?? null;
      if (!cell) return next;
      if (!next) return cell;
      if (!cellIsOpen(cell) && cellIsOpen(next)) return next;
      return next;
    }),
  };
}

/**
 * Une fragmentos reais do mesmo mercado sem preencher lacunas inexistentes.
 * As colunas são alinhadas por identidade semântica e cada `null` continua
 * representando uma célula que a casa não ofertou.
 */
export function mergeMarketModels(current: MarketModel, incoming: MarketModel): MarketModel {
  const columns = [...current.columns];
  const columnKeys = new Set(columns.map((column) => column.key));
  incoming.columns.forEach((column) => {
    if (columnKeys.has(column.key)) return;
    columnKeys.add(column.key);
    columns.push(column);
  });

  const currentRows = current.rows.map((row) => alignRow(row, current.columns, columns));
  const incomingRows = incoming.rows.map((row) => alignRow(row, incoming.columns, columns));
  const rows = [...currentRows];
  const rowIndexByPlayer = new Map(rows.map((row, index) => [row.playerId, index]));

  incomingRows.forEach((row) => {
    const existingIndex = rowIndexByPlayer.get(row.playerId);
    if (existingIndex === undefined) {
      rowIndexByPlayer.set(row.playerId, rows.length);
      rows.push(row);
      return;
    }
    rows[existingIndex] = mergeRows(rows[existingIndex], row);
  });

  return {
    ...current,
    displayName: incoming.displayName || current.displayName,
    isPlayerMarket: current.isPlayerMarket || incoming.isPlayerMarket,
    status:
      current.status === "open" || incoming.status === "open"
        ? "open"
        : incoming.status,
    columns,
    rows,
    updatedAt:
      Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt)
        ? incoming.updatedAt
        : current.updatedAt,
  };
}

export function consolidateMarketModels(markets: MarketModel[]) {
  const byIdentity = new Map<string, MarketModel>();
  markets.forEach((market) => {
    const current = byIdentity.get(market.id);
    byIdentity.set(market.id, current ? mergeMarketModels(current, market) : market);
  });
  return [...byIdentity.values()];
}
