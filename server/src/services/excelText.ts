import ExcelJS from "exceljs";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * An Excel workbook as plain text: one "### Sheet: <name>" block per sheet,
 * one line per row, cells separated by tabs. Line breaks inside a cell
 * become " | " so a row stays on one line. Used for the school calendar sync
 * and so the assistant can read Excel files from Drive.
 */
export async function workbookToText(bytes: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const blocks: string[] = [];
  workbook.eachSheet((sheet) => {
    const lines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) {
        cells.push(cellText(row.getCell(c)).replace(/\t/g, " ").replace(/\s*\r?\n\s*/g, " | ").trim());
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) lines.push(cells.join("\t"));
    });
    blocks.push(`### Sheet: ${sheet.name.trim()}\n${lines.join("\n")}`);
  });
  return blocks.join("\n\n");
}

function cellText(cell: ExcelJS.Cell): string {
  try {
    return cell.text ?? "";
  } catch {
    return String(cell.value ?? "");
  }
}
