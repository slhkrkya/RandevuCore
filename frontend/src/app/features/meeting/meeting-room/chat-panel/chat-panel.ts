import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
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
}

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

  @Output() close = new EventEmitter<void>();

  @ViewChild('messageInput', { static: true }) messageInput!: ElementRef<HTMLInputElement>;
  @ViewChild('messagesContainer', { static: true }) messagesContainer!: ElementRef<HTMLDivElement>;

  messages: ChatMessage[] = [];
  newMessage = '';
  isConnected = false;

  constructor(private signalr: SignalRService) {}

  ngOnInit() {
    this.setupSignalRListeners();
  }

  ngOnDestroy() {
    // Cleanup if needed
  }

  private setupSignalRListeners() {
    // Listen for chat messages
    this.signalr.on<any>('chat-message', (message) => {
      this.handleChatMessage(message);
    });

    // Listen for connection status
    this.signalr.on<any>('connection-status', (status) => {
      this.isConnected = status.connected;
    });
  }

  private handleChatMessage(message: any) {
    const chatMessage: ChatMessage = {
      id: message.id || Date.now().toString(),
      userId: message.userId,
      userName: message.userName,
      message: message.message,
      timestamp: new Date(message.timestamp || Date.now()),
      isOwn: message.userId === this.currentUserId
    };

    this.messages.push(chatMessage);
    this.scrollToBottom();
  }

  async sendMessage() {
    if (!this.newMessage.trim() || !this.isConnected) return;

    const message = {
      id: Date.now().toString(),
      userId: this.currentUserId,
      userName: this.currentUserName,
      message: this.newMessage.trim(),
      timestamp: new Date()
    };

    try {
      await this.signalr.sendToRoom(this.roomKey, 'chat-message', message);
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
    this.messages = [];
  }
}
