import markdown
import os

# Read the markdown file
with open('BAL-MANDAL-COMPLETE-MANUAL.md', 'r', encoding='utf-8') as f:
    md_content = f.read()

# Convert to HTML
html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code', 'toc'])

# Create full HTML document with styling
html_doc = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Bal Mandal & Sishu Mandal User Manual</title>
    <style>
        @page {{
            size: A4;
            margin: 2cm;
        }}
        body {{
            font-family: 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }}
        h1 {{
            color: #0F172A;
            border-bottom: 3px solid #38BDF8;
            padding-bottom: 10px;
            page-break-after: avoid;
        }}
        h2 {{
            color: #1E293B;
            border-bottom: 2px solid #22D3EE;
            padding-bottom: 8px;
            margin-top: 30px;
            page-break-after: avoid;
        }}
        h3 {{
            color: #334155;
            margin-top: 25px;
            page-break-after: avoid;
        }}
        code {{
            background-color: #F1F5F9;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Consolas', monospace;
            font-size: 0.9em;
        }}
        pre {{
            background-color: #F1F5F9;
            padding: 15px;
            border-radius: 5px;
            border-left: 4px solid #38BDF8;
            overflow-x: auto;
            page-break-inside: avoid;
        }}
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 20px 0;
            page-break-inside: avoid;
        }}
        th {{
            background-color: #0F172A;
            color: white;
            padding: 12px;
            text-align: left;
        }}
        td {{
            border: 1px solid #E2E8F0;
            padding: 10px;
        }}
        tr:nth-child(even) {{
            background-color: #F8FAFC;
        }}
        .toc {{
            background-color: #F8FAFC;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }}
        blockquote {{
            border-left: 4px solid #F97316;
            padding-left: 20px;
            margin-left: 0;
            color: #64748B;
            font-style: italic;
        }}
        hr {{
            border: none;
            border-top: 2px solid #E2E8F0;
            margin: 30px 0;
        }}
        @media print {{
            body {{
                margin: 0;
            }}
            h1, h2, h3 {{
                page-break-after: avoid;
            }}
            pre, table {{
                page-break-inside: avoid;
            }}
        }}
    </style>
</head>
<body>
{html_content}
</body>
</html>
"""

# Write HTML file
with open('BAL-MANDAL-MANUAL.html', 'w', encoding='utf-8') as f:
    f.write(html_doc)

print("HTML file created: BAL-MANDAL-MANUAL.html")
print("Open in browser and use Print -> Save as PDF")
