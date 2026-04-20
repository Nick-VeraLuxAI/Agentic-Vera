import os
import shutil
from pathlib import Path
from docx import Document
from fpdf import FPDF

def convert_docx_to_pdf(docx_path, pdf_path):
    # Placeholder: Real docx → PDF conversion requires MS Word or third-party lib
    # This stub generates a dummy PDF with the docx text
    doc = Document(docx_path)
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)

    for para in doc.paragraphs:
        pdf.multi_cell(0, 10, para.text)

    pdf.output(pdf_path)
    return pdf_path

def rename_file(original_path, new_name):
    target = Path(original_path).parent / new_name
    os.rename(original_path, target)
    return str(target)

def zip_folder(folder_path, output_path):
    shutil.make_archive(output_path, 'zip', folder_path)
    return output_path + '.zip'
