import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MeetingState } from '../meeting-room';

@Component({
  selector: 'app-meeting-controls',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meeting-controls.html',
  styleUrls: ['./meeting-controls.css']
})
export class MeetingControlsComponent {
  @Input() meetingState: MeetingState = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };
  
  @Input() isHost = false;
  @Input() participantsCount = 0;
  @Input() showParticipantsPanel = false;
  @Input() showChatPanel = false;
  @Input() showWhiteboardPanel = false;
  @Input() activeView: 'grid' | 'speaker' | 'whiteboard' = 'grid';
  @Input() isMuteToggling = false;
  @Input() isVideoToggling = false;
  @Input() isScreenShareToggling = false;
  @Input() meetingDuration = '00:00:00';

  @Output() toggleMute = new EventEmitter<void>();
  @Output() toggleVideo = new EventEmitter<void>();
  @Output() toggleScreenShare = new EventEmitter<void>();
  @Output() toggleParticipantsPanel = new EventEmitter<void>();
  @Output() toggleChatPanel = new EventEmitter<void>();
  @Output() toggleWhiteboardPanel = new EventEmitter<void>();
  @Output() setActiveView = new EventEmitter<'grid' | 'speaker' | 'whiteboard'>();
  @Output() toggleFullscreen = new EventEmitter<void>();
  @Output() endMeeting = new EventEmitter<void>();

  onToggleMute() {
    this.toggleMute.emit();
  }

  onToggleVideo() {
    this.toggleVideo.emit();
  }

  onToggleScreenShare() {
    this.toggleScreenShare.emit();
  }

  onToggleParticipantsPanel() {
    this.toggleParticipantsPanel.emit();
  }

  onToggleChatPanel() {
    this.toggleChatPanel.emit();
  }

  onToggleWhiteboardPanel() {
    this.toggleWhiteboardPanel.emit();
  }

  onSetActiveView(view: 'grid' | 'speaker' | 'whiteboard') {
    this.setActiveView.emit(view);
  }

  onToggleFullscreen() {
    this.toggleFullscreen.emit();
  }

  onEndMeeting() {
    this.endMeeting.emit();
  }

  getMuteButtonClass(): string {
    return this.meetingState.isMuted 
      ? 'bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500' 
      : 'bg-slate-600 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600';
  }

  getVideoButtonClass(): string {
    return this.meetingState.isVideoOn 
      ? 'bg-slate-600 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600' 
      : 'bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500';
  }

  getScreenShareButtonClass(): string {
    return this.meetingState.isScreenSharing 
      ? 'bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500' 
      : 'bg-slate-600 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600';
  }

  getViewButtonClass(view: 'grid' | 'speaker' | 'whiteboard'): string {
    return this.activeView === view 
      ? 'bg-blue-500 text-white dark:bg-blue-600 dark:text-white' 
      : 'bg-slate-600 hover:bg-slate-700 text-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200';
  }
}
