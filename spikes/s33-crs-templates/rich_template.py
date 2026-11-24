"""Spike S33 (M13-06): a self-made template with the parts a real project form
may carry that ExcelJS has no model for, made with openpyxl (MIT; spike tooling
only, never shipped, optional: the run skips it without Python). Rule 13: the
content is invented.

    python3 -I spikes/s33-crs-templates/rich_template.py <out.xlsx>
"""

import os
import sys
import zipfile

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.comments import Comment
from openpyxl.formatting.rule import DataBarRule
from openpyxl.styles import Border, Font, NamedStyle, PatternFill, Side
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.table import Table, TableStyleInfo

out = sys.argv[1]
wb = Workbook()
ws = wb.active
ws.title = "CRS"
thin = Side(style="thin")
box = Border(left=thin, right=thin, top=thin, bottom=thin)

title = NamedStyle(name="CRS Title", font=Font(bold=True, size=16))
wb.add_named_style(title)
ws["A1"] = "Comment register"
ws["A1"].style = "CRS Title"
ws.merge_cells("A1:F1")
ws["A2"] = "Doc No."
ws["B2"].border = box
ws["A2"].comment = Comment("Type the document number from the title block.", "Form owner")
ws["F2"] = "Help"
ws["F2"].hyperlink = "https://example.com/crs-help"

heads = ["No.", "Page", "Comment", "Status", "Response", "Score"]
for i, h in enumerate(heads, start=1):
    c = ws.cell(row=4, column=i, value=h)
    c.font = Font(bold=True)
    c.fill = PatternFill("solid", fgColor="D9E1F2")
    c.border = box
for r in range(5, 15):
    for col in range(1, 7):
        ws.cell(row=r, column=col).border = box
    ws.cell(row=r, column=6, value=f'=IF(D{r}="Closed",1,0)')
ws.conditional_formatting.add("F5:F14", DataBarRule(start_type="min", end_type="max", color="638EC6"))
ws.row_dimensions[16].outlineLevel = 1
ws["A16"] = "Grouped note row"
ws.oddFooter.center.text = "CRS &P / &N"
ws.protection.sheet = False

# A summary sheet with a real Excel table and a chart.
summary = wb.create_sheet("Summary")
summary.append(["Status", "Count"])
for s, f in [("Open", '=COUNTIF(CRS!D5:D14,"Open")'), ("Closed", '=COUNTIF(CRS!D5:D14,"Closed")')]:
    summary.append([s, f])
table = Table(displayName="StatusTable", ref="A1:B3")
table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
summary.add_table(table)
chart = BarChart()
chart.title = "Comments by status"
chart.add_data(Reference(summary, min_col=2, min_row=1, max_row=3), titles_from_data=True)
chart.set_categories(Reference(summary, min_col=1, min_row=2, max_row=3))
summary.add_chart(chart, "D2")
summary.protection.sheet = True

hidden = wb.create_sheet("Codes")
for i, v in enumerate(["Open", "Closed", "Hold"], start=1):
    hidden.cell(row=i, column=1, value=v)
hidden.sheet_state = "hidden"
wb.defined_names["StatusCodes"] = DefinedName("StatusCodes", attr_text="Codes!$A$1:$A$3")
wb.security = None
wb.save(out)

# An Excel-2010 style drop-down (x14, in the sheet's extLst) pointing at the
# hidden sheet, as older project forms carry; and a sparkline group.
EXT = (
    '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" '
    'xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'
    '<x14:dataValidations count="1" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">'
    '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">'
    "<x14:formula1><xm:f>Codes!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>D5:D14</xm:sqref>"
    "</x14:dataValidation></x14:dataValidations></ext>"
    '<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" '
    'xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'
    '<x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">'
    '<x14:sparklineGroup displayEmptyCellsAs="gap"><x14:colorSeries rgb="FF376092"/>'
    '<x14:sparklines><x14:sparkline><xm:f>CRS!F5:F14</xm:f><xm:sqref>G4</xm:sqref></x14:sparkline>'
    "</x14:sparklines></x14:sparklineGroup></x14:sparklineGroups></ext></extLst>"
)
import re
import shutil

# openpyxl writes drawings with a default namespace (<wsDr xmlns=...>), comments
# at xl/comments/comment1.xml and absolute relationship targets; ExcelJS 4.4.0
# finds parts by Excel's own names and prefixes, and its load fails on that
# file. That copy is kept as <out>-default-ns.xlsx; the main file is made to
# look as Excel writes it.
shutil.copy(out, out.replace(".xlsx", "-default-ns.xlsx"))
XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"


def prefix_drawing(xml):
    xml = xml.replace(f'xmlns="{XDR}"', f'xmlns:xdr="{XDR}"')
    return re.sub(r"<(/?)(?![A-Za-z0-9]+:)([A-Za-z][A-Za-z0-9]*)", r"<\1xdr:\2", xml)


tmp = out + ".tmp"
with zipfile.ZipFile(out) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        # Comments where Excel puts them (xl/commentsN.xml, ../drawings/vmlDrawingN.vml):
        # ExcelJS finds parts by Excel's names, not by following the relationships.
        if item.filename == "xl/comments/comment1.xml":
            item.filename = "xl/comments1.xml"
        if item.filename == "xl/drawings/commentsDrawing1.vml":
            item.filename = "xl/drawings/vmlDrawing1.vml"
        if item.filename in ("[Content_Types].xml", "xl/worksheets/_rels/sheet1.xml.rels"):
            data = (
                data.decode("utf-8")
                .replace("/xl/comments/comment1.xml", "/xl/comments1.xml")
                .replace("/xl/drawings/commentsDrawing1.vml", "/xl/drawings/vmlDrawing1.vml")
                .encode("utf-8")
            )
        # ...and relative relationship targets, as Excel writes them.
        if re.fullmatch(r"xl/(worksheets|drawings)/_rels/[^/]+\.rels", item.filename):
            data = data.decode("utf-8").replace('Target="/xl/', 'Target="../').encode("utf-8")
        if item.filename == "xl/_rels/workbook.xml.rels":
            data = data.decode("utf-8").replace('Target="/xl/', 'Target="').encode("utf-8")
        if re.fullmatch(r"xl/drawings/drawing\d+\.xml", item.filename):
            data = prefix_drawing(data.decode("utf-8")).encode("utf-8")
        if item.filename == "xl/worksheets/sheet1.xml":
            xml = data.decode("utf-8")
            if "<extLst>" in xml:
                raise SystemExit("unexpected extLst")
            xml = xml.replace("</worksheet>", EXT + "</worksheet>")
            data = xml.encode("utf-8")
        zout.writestr(item, data)
os.replace(tmp, out)
print(out)
