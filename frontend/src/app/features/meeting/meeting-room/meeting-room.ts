import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SignalRService } from '../../../core/services/signalr';

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meeting-room.html',
  styleUrls: ['./meeting-room.css']
})
export class MeetingRoomComponent implements OnInit, OnDestroy {
  meetingId = '';
  connected = false;

  constructor(private route: ActivatedRoute, private signalr: SignalRService) {}

  async ngOnInit() {
    this.meetingId = this.route.snapshot.paramMap.get('id') || '';
    const token = localStorage.getItem('token') || '';
    await this.signalr.start(token);
    await this.signalr.joinRoom(`meeting-${this.meetingId}`);
    this.connected = true;
  }

  async ngOnDestroy() {
    await this.signalr.leaveRoom(`meeting-${this.meetingId}`);
  }
}


