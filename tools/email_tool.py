import smtplib
from email.message import EmailMessage
import os

def send_email(to_address, subject, body, attachments=[]):
    msg = EmailMessage()
    msg['From'] = os.getenv('EMAIL_SENDER') or 'vera@yourdomain.com'
    msg['To'] = to_address
    msg['Subject'] = subject
    msg.set_content(body)

    for file in attachments:
        with open(file, 'rb') as f:
            file_data = f.read()
            file_name = os.path.basename(file)
            msg.add_attachment(file_data, maintype='application', subtype='octet-stream', filename=file_name)

    smtp_host = os.getenv('SMTP_HOST')
    smtp_port = int(os.getenv('SMTP_PORT') or 587)
    smtp_user = os.getenv('SMTP_USER')
    smtp_pass = os.getenv('SMTP_PASS')

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)
        return f"Email sent to {to_address}"
