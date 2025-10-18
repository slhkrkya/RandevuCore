import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SignalRService } from '../../../../core/services/signalr';

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: Date;
  isOwn: boolean;
  type: 'chat';
}

export interface FileMessage {
  id: string;
  userId: string;
  userName: string;
  originalFileName: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadPath: string;
  timestamp: Date;
  isOwn: boolean;
  type: 'file';
}

export type Message = ChatMessage | FileMessage;

@Component({
  selector: 'app-chat-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-panel.html',
  styleUrls: ['./chat-panel.css']
})
export class ChatPanelComponent implements OnInit, OnDestroy {
  @Input() roomKey = '';
  @Input() currentUserId = '';
  @Input() currentUserName = '';
  @Input() isHost = false;

  @Output() close = new EventEmitter<void>();

  @ViewChild('messageInput', { static: true }) messageInput!: ElementRef<HTMLInputElement>;
  @ViewChild('messagesContainer', { static: true }) messagesContainer!: ElementRef<HTMLDivElement>;

  messages: ChatMessage[] = [];
  fileMessages: FileMessage[] = [];
  allMessages: Message[] = [];
  newMessage = '';
  isConnected = false;
  isUploading = false;

  constructor(
    private signalr: SignalRService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.setupSignalRListeners();
    // Set initial connection status
    this.updateConnectionStatus();
  }

  private updateConnectionStatus() {
    this.isConnected = this.signalr.isConnected();
    this.cdr.markForCheck();
  }

  ngOnDestroy() {
    // Clean up SignalR listeners
    this.signalr.off('chat-message');
    this.signalr.off('chat-history');
    this.signalr.off('file-message');
    this.signalr.off('file-history');
    this.signalr.off('connection-status');
  }

  private setupSignalRListeners() {
    // Wait for connection to be ready
    const setupListeners = () => {
      // Listen for chat messages
      this.signalr.on<any>('chat-message', (message) => {
        this.handleChatMessage(message);
      });

      // Listen for chat history (when joining a room)
      this.signalr.on<any>('chat-history', (messages) => {
        this.handleChatHistory(messages);
      });

      // Listen for file messages
      this.signalr.on<any>('file-message', (fileMessage) => {
        this.handleFileMessage(fileMessage);
      });

      // Listen for file history (when joining a room)
      this.signalr.on<any>('file-history', (fileMessages) => {
        this.handleFileHistory(fileMessages);
      });

      // Listen for connection status changes
      this.signalr.on<any>('connection-status', (status) => {
        this.isConnected = status.connected;
        this.cdr.markForCheck();
      });

      // Listen for chat cleared signal
      this.signalr.on<any>('chat-cleared', (data) => {
        if (data.roomId === this.roomKey) {
          this.messages = [];
          this.fileMessages = [];
          this.allMessages = [];
          this.cdr.markForCheck();
        }
      });
    };

    // If connection is ready, setup listeners immediately
    if (this.signalr.isConnected()) {
      setupListeners();
    } else {
      // Wait for connection to be ready
      const checkConnection = setInterval(() => {
        if (this.signalr.isConnected()) {
          setupListeners();
          clearInterval(checkConnection);
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkConnection);
      }, 10000);
    }

    // Update connection status periodically
    setInterval(() => {
      this.updateConnectionStatus();
    }, 2000);
  }

  private handleChatMessage(message: any) {
    const chatMessage: ChatMessage = {
      id: message.id || Date.now().toString(),
      userId: message.userId,
      userName: message.userName,
      message: message.message,
      timestamp: new Date(message.timestamp || Date.now()),
      isOwn: message.userId === this.currentUserId,
      type: 'chat'
    };

    this.messages.push(chatMessage);
    this.updateAllMessages();
    this.cdr.markForCheck();
    this.scrollToBottom();
  }

  private handleChatHistory(messages: any[]) {
    // Clear existing messages and load chat history
    this.messages = messages.map(message => ({
      id: message.id || Date.now().toString(),
      userId: message.userId,
      userName: message.userName,
      message: message.message,
      timestamp: new Date(message.timestamp || Date.now()),
      isOwn: message.userId === this.currentUserId,
      type: 'chat' as const
    }));

    this.updateAllMessages();
    this.cdr.markForCheck();
    this.scrollToBottom();
  }

  private handleFileMessage(fileMessage: any) {
    const fileMsg: FileMessage = {
      id: fileMessage.id || Date.now().toString(),
      userId: fileMessage.userId,
      userName: fileMessage.userName,
      originalFileName: fileMessage.originalFileName,
      fileName: fileMessage.fileName,
      fileSize: fileMessage.fileSize,
      fileType: fileMessage.fileType,
      uploadPath: fileMessage.uploadPath,
      timestamp: new Date(fileMessage.timestamp || Date.now()),
      isOwn: fileMessage.userId === this.currentUserId,
      type: 'file'
    };

    this.fileMessages.push(fileMsg);
    this.updateAllMessages();
    this.cdr.markForCheck();
    this.scrollToBottom();
  }

  private handleFileHistory(fileMessages: any[]) {
    // Clear existing file messages and load file history
    this.fileMessages = fileMessages.map(fileMessage => ({
      id: fileMessage.id || Date.now().toString(),
      userId: fileMessage.userId,
      userName: fileMessage.userName,
      originalFileName: fileMessage.originalFileName,
      fileName: fileMessage.fileName,
      fileSize: fileMessage.fileSize,
      fileType: fileMessage.fileType,
      uploadPath: fileMessage.uploadPath,
      timestamp: new Date(fileMessage.timestamp || Date.now()),
      isOwn: fileMessage.userId === this.currentUserId,
      type: 'file' as const
    }));

    this.updateAllMessages();
    this.cdr.markForCheck();
    this.scrollToBottom();
  }

  async sendMessage() {
    if (!this.newMessage.trim() || !this.isConnected) return;

    try {
      await this.signalr.invoke('SendChatMessage', this.roomKey, this.newMessage.trim());
      this.newMessage = '';
      this.messageInput.nativeElement.focus();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  onKeyPress(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop = this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 100);
  }

  formatTimestamp(timestamp: Date): string {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) {
      return 'Az önce';
    } else if (minutes < 60) {
      return `${minutes} dk önce`;
    } else if (hours < 24) {
      return `${hours} saat önce`;
    } else if (days < 7) {
      return `${days} gün önce`;
    } else {
      return timestamp.toLocaleDateString('tr-TR');
    }
  }

  getMessageTime(timestamp: Date): string {
    return timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }

  onClose() {
    this.close.emit();
  }

  clearChat() {
    if (!this.isHost) return; // Güvenlik kontrolü
    
    // Onay iste
    if (confirm('Tüm sohbet geçmişini silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.')) {
      // Backend'e temizleme sinyali gönder
      this.signalr.invoke('ClearChat', this.roomKey).then(() => {
        // Frontend'de de temizle
        this.messages = [];
        this.fileMessages = [];
        this.allMessages = [];
      }).catch((error) => {
        console.error('Error clearing chat:', error);
        alert('Sohbet temizlenirken bir hata oluştu.');
      });
    }
  }

  private updateAllMessages() {
    // Combine chat and file messages and sort by timestamp
    this.allMessages = [
      ...this.messages,
      ...this.fileMessages
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file || !this.isConnected) return;

    // Dosya boyutu kontrolü (10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Dosya boyutu 10MB\'dan büyük olamaz.');
      return;
    }

    this.isUploading = true;
    this.cdr.markForCheck();

    try {
      console.log('Uploading file:', file.name, 'Size:', file.size, 'RoomId:', this.roomKey);
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('roomId', this.roomKey);

      const response = await fetch('/api/file/upload', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Upload error response:', errorText);
        throw new Error(`Dosya yüklenemedi: ${response.status} - ${errorText}`);
      }

      const fileInfo = await response.json();
      
      // SignalR ile dosya mesajını gönder
      await this.signalr.invoke('SendFileMessage', this.roomKey, fileInfo);
      
    } catch (error) {
      console.error('Dosya yükleme hatası:', error);
      alert('Dosya yüklenirken bir hata oluştu.');
    } finally {
      this.isUploading = false;
      this.cdr.markForCheck();
      // Input'u temizle
      event.target.value = '';
    }
  }

  async downloadFile(message: Message) {
    if (message.type !== 'file') return;
    
    const fileMessage = message as FileMessage;
    // URL encode the fileName to handle special characters and spaces
    const encodedFileName = encodeURIComponent(fileMessage.fileName);
    const downloadUrl = `/api/file/download/${this.roomKey}/${encodedFileName}`;
    
    // Extract original filename by removing the GUID prefix (same logic as backend)
    let cleanFileName = fileMessage.originalFileName;
    
    // If originalFileName is empty, try to extract from fileName
    if (!cleanFileName && fileMessage.fileName) {
      cleanFileName = fileMessage.fileName;
    }
    
    if (cleanFileName && cleanFileName.includes('_')) {
      const underscoreIndex = cleanFileName.indexOf('_');
      const potentialGuid = cleanFileName.substring(0, underscoreIndex);
      // Check if it looks like a GUID (36 chars with 4 dashes)
      if (potentialGuid.length === 36 && (potentialGuid.match(/-/g) || []).length === 4) {
        cleanFileName = cleanFileName.substring(underscoreIndex + 1);
      }
    }
    
    console.log('Downloading file:', {
      originalFileName: fileMessage.originalFileName,
      cleanFileName: cleanFileName,
      fileName: fileMessage.fileName,
      encodedFileName: encodedFileName,
      downloadUrl: downloadUrl,
      roomKey: this.roomKey
    });
    
    try {
      // SECURITY: Get token securely
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Authentication token not found');
      }
      
      // Use fetch with authorization header
      const response = await fetch(downloadUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate', // Prevent caching
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication failed. Please login again.');
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Get the file blob
      const blob = await response.blob();
      
      // SECURITY: Validate blob size (prevent empty or corrupted files)
      if (blob.size === 0) {
        throw new Error('Downloaded file is empty');
      }
      
      // Create download link with security measures
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = cleanFileName;
      link.style.display = 'none';
      link.setAttribute('download', cleanFileName); // Explicit download attribute
      
      // SECURITY: Add security attributes
      link.setAttribute('rel', 'noopener noreferrer');
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // SECURITY: Immediately clean up the URL object to prevent memory leaks
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 100);
      
      console.log('File downloaded successfully:', cleanFileName);
      
    } catch (error) {
      console.error('Download error:', error);
      alert('Dosya indirilirken bir hata oluştu. Lütfen tekrar deneyin.');
    }
  }

  getFileIcon(fileType: string): string {
    const iconMap: { [key: string]: string } = {
      '.pdf': 'picture_as_pdf',
      '.doc': 'description',
      '.docx': 'description',
      '.txt': 'text_snippet',
      '.jpg': 'image',
      '.jpeg': 'image',
      '.png': 'image',
      '.gif': 'image',
      '.zip': 'archive',
      '.rar': 'archive',
      '.xlsx': 'table_chart',
      '.xls': 'table_chart',
      '.pptx': 'slideshow',
      '.ppt': 'slideshow'
    };
    
    return iconMap[fileType.toLowerCase()] || 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}



