import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Participant } from '../meeting-room';
import { ParticipantService } from '../services/participant.service';
import { ParticipantUIService } from '../services/participant-ui.service';

@Component({
  selector: 'app-participants-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './participants-panel.html',
  styleUrls: ['./participants-panel.css']
})
export class ParticipantsPanelComponent implements OnInit, OnDestroy {
  @Input() currentUserId = '';
  @Input() isHost = false;

  participants: Participant[] = [];
  private participantsSubscription?: Subscription;

  @Output() grantPermission = new EventEmitter<{ userId: string; permission: string }>();
  @Output() removeParticipant = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  constructor(
    private participantService: ParticipantService,
    private participantUI: ParticipantUIService
  ) {}

  ngOnInit() {
    // Subscribe to participant service updates
    this.participantsSubscription = this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
    });
  }

  ngOnDestroy() {
    this.participantsSubscription?.unsubscribe();
  }

  // ✅ UNIFIED: Use service methods instead of duplicates
  getParticipantInitials(participant: Participant): string {
    return this.participantUI.getParticipantInitials(participant);
  }

  getParticipantBackgroundColor(participant: Participant): string {
    return this.participantUI.getParticipantBackgroundColor(participant);
  }

  getParticipantDisplayName(participant: Participant): string {
    return this.participantUI.getParticipantDisplayName(participant, this.currentUserId);
  }

  getParticipantStatus(participant: Participant): string {
    return this.participantUI.getParticipantStatus(participant);
  }

  onGrantPermission(userId: string, permission: string) {
    this.grantPermission.emit({ userId, permission });
  }

  onRemoveParticipant(userId: string) {
    this.removeParticipant.emit(userId);
  }

  onClose() {
    this.close.emit();
  }
}
