"""
DCAUD HTTP Client & Bot v1.0.0
GUI Example File
Developed by Aditya @xdityagr, 2025
"""

import sys
import os
import random

from bot_utils_qt import BotController
from PySide6.QtCore import *
from PySide6.QtGui import *
from PySide6.QtWidgets import *

class ImageLoaderSignals(QObject):
    loaded = Signal(QPixmap)

class ImageLoader(QRunnable):
    def __init__(self, path):
        super().__init__()
        self.path = path
        self.signals = ImageLoaderSignals()

    def run(self):
        pixmap = QPixmap(self.path)
        if not pixmap.isNull():
            self.signals.loaded.emit(pixmap)

class BotControllerGUI(QMainWindow):
    def __init__(self):
        super().__init__()
        self.bot_controller = BotController()
        self.bot_controller.signals.speaking_update.connect(self.on_speaking_update, Qt.QueuedConnection)
        self.bot_controller.signals.log_message.connect(self.on_log_message, Qt.QueuedConnection)
        self.bot_controller.signals.status_changed.connect(self.on_status_changed, Qt.QueuedConnection)
        
        self.image_pool = QThreadPool()
        self.image_pool.setMaxThreadCount(4)
        self.pixmaps = []
        self.image_folder = ""
        self.current_status = "Stopped"
        
        self.init_ui()

    def init_ui(self):
        self.setWindowTitle("DCAUD Client Example - v1.0.0")

        self.setGeometry(100, 100, 800, 600)
        
        main_layout = QVBoxLayout()
        
        # Configuration group
        config_group = QGroupBox("Configuration")
        config_layout = QFormLayout()

        self.setWindowIcon(QIcon('window_icon.ico'))
        
        self.username_input = QLineEdit("")
        self.username_input.setPlaceholderText("Discord username to monitor")
        config_layout.addRow("Target Username:", self.username_input)
        
        self.folder_input = QLineEdit("")
        self.folder_input.setPlaceholderText("Select image folder")
        self.folder_input.setReadOnly(True)
        folder_button = QPushButton("Browse")
        folder_button.clicked.connect(self.select_image_folder)
        folder_layout = QHBoxLayout()
        folder_layout.addWidget(self.folder_input)
        folder_layout.addWidget(folder_button)
        config_layout.addRow("Image Folder:", folder_layout)
        
        config_group.setLayout(config_layout)
        main_layout.addWidget(config_group)
        
        # Status display
        self.status_display = QLabel("Bot Stopped")
        self.status_display.setAlignment(Qt.AlignCenter)
        main_layout.addWidget(self.status_display)
        
        # Button layout
        button_layout = QHBoxLayout()
        
        self.start_button = QPushButton("Start Bot")
        self.start_button.clicked.connect(self.start_bot)
        button_layout.addWidget(self.start_button)
        
        self.stop_button = QPushButton("Stop Bot")
        self.stop_button.clicked.connect(self.stop_bot)
        self.stop_button.setEnabled(False)
        button_layout.addWidget(self.stop_button)
        
        self.clear_log_button = QPushButton("Clear Log")
        self.clear_log_button.clicked.connect(self.clear_log)
        button_layout.addWidget(self.clear_log_button)
        
        main_layout.addLayout(button_layout)
        
        # Speaking status
        status_layout = QHBoxLayout()
        self.speaking_status = QLabel("Speaking: N/A")
        status_layout.addWidget(self.speaking_status)
        main_layout.addLayout(status_layout)
        
        # Tabs for image and log
        tabs = QTabWidget()
        
        # Image tab
        image_widget = QWidget()
        image_layout = QVBoxLayout()
        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignCenter)
        self.image_label.setMinimumSize(400, 400)
        self.image_label.setStyleSheet("border: 1px solid black;")
        image_layout.addWidget(self.image_label)
        image_widget.setLayout(image_layout)
        tabs.addTab(image_widget, "Image Display")
        
        # Log tab
        log_group = QGroupBox("Bot Log")
        log_layout = QVBoxLayout()
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        log_layout.addWidget(self.log_text)
        log_group.setLayout(log_layout)
        tabs.addTab(log_group, "Log")
        
        main_layout.addWidget(tabs)
        
        # Set central widget
        central_widget = QWidget()
        central_widget.setLayout(main_layout)
        self.setCentralWidget(central_widget)

    def select_image_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Image Folder")
        if folder:
            self.image_folder = folder
            self.folder_input.setText(folder)
            self.load_images()

    def load_images(self):
        self.pixmaps.clear()
        if not self.image_folder:
            return
            
        dir = QDir(self.image_folder)
        filters = ["*.png", "*.jpg", "*.jpeg", "*.bmp"]
        dir.setNameFilters(filters)
        image_files = dir.entryList()
        
        for image_file in image_files:
            loader = ImageLoader(os.path.join(self.image_folder, image_file))
            loader.signals.loaded.connect(self.on_image_loaded)
            self.image_pool.start(loader)

    @Slot(QPixmap)
    def on_image_loaded(self, pixmap):
        if not pixmap.isNull():
            scaled_pixmap = pixmap.scaled(400, 400, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            self.pixmaps.append(scaled_pixmap)

    def start_bot(self):
        username = self.username_input.text().strip()
        
        if not self.image_folder:
            QMessageBox.warning(self, "Configuration Error", "Please select an image folder.")
            return
        
        if not username:
            response = QMessageBox.question(
                self, 
                "No Username", 
                "No target username specified. Continue anyway?",
                QMessageBox.Yes | QMessageBox.No
            )
            if response == QMessageBox.No:
                return
        
        self.bot_controller.exe_path = "DCAUD.exe"
        self.status_display.setText("Bot Starting...")
        success = self.bot_controller.start(username if username else None, 3001)
        if success:
            self.current_status = "Starting"

    def stop_bot(self):
        self.bot_controller.stop()
        self.status_display.setText("Bot Stopped")
        self.current_status = "Stopped"
        
    def clear_log(self):
        self.log_text.clear()
        
    @Slot(dict)
    def on_speaking_update(self, data):
        username = data.get('username', 'Unknown')
        speaking = data.get('speaking', False)
        
        status_text = f"Speaking: {username} is {'speaking' if speaking else 'silent'}"
        self.speaking_status.setText(status_text)
        
        if speaking:
            self.speaking_status.setStyleSheet("color: green; font-weight: bold;")
            if self.pixmaps:
                self.image_label.setPixmap(random.choice(self.pixmaps))
        else:
            self.speaking_status.setStyleSheet("color: black; font-weight: normal;")
            
    @Slot(str)
    def on_log_message(self, message):
        self.log_text.append(message)
        cursor = self.log_text.textCursor()
        cursor.movePosition(QTextCursor.End)
        self.log_text.setTextCursor(cursor)
        
        if "Logged in as DCAudioDetection#5665" in message:
            self.status_display.setText("You can join the bot on the server using !join now")
            self.current_status = "Running"
            
        elif "Bot started" in message and self.current_status == "Starting":
            self.status_display.setText("Bot Running")
            self.current_status = "Running"

    @Slot(bool)
    def on_status_changed(self, running):
        if running:
            self.start_button.setEnabled(False)
            self.stop_button.setEnabled(True)
            self.username_input.setEnabled(False)
            self.folder_input.setEnabled(False)
        else:
            self.start_button.setEnabled(True)
            self.stop_button.setEnabled(False)
            self.username_input.setEnabled(True)
            self.folder_input.setEnabled(True)
            self.speaking_status.setText("Speaking: N/A")
            self.speaking_status.setStyleSheet("color: black; font-weight: normal;")
            self.status_display.setText("Bot Stopped")
            self.current_status = "Stopped"

    def closeEvent(self, event):
        self.bot_controller.cleanup()
        self.image_pool.clear()
        self.image_pool.waitForDone()
        event.accept()

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = BotControllerGUI()
    window.show()
    sys.exit(app.exec())
