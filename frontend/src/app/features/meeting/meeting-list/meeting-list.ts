import { Component, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth';

interface MeetingInvitee {
  id: string;
  name: string;
  email: string;
}

interface Meeting {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  status: 'scheduled' | 'canceled' | 'done';
  creatorId: string;
  videoSessionId?: string;
  whiteboardSessionId?: string;
  invitees?: MeetingInvitee[]; // Optional, can be undefined
  createdAt: string;
  updatedAt: string;
}

@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe],
  templateUrl: './meeting-list.html',
  styleUrls: ['./meeting-list.css']
})
export class MeetingListComponent implements OnInit {
  items: Meeting[] = [];
  loading = true;
  error: string | null = null;

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {}

  ngOnInit() {
    this.loadMeetings();
  }

  loadMeetings() {
    this.loading = true;
    this.error = null;
    
    const token = this.auth.getToken();
    if (!token) {
      this.error = 'Oturum açmanız gerekiyor';
      this.loading = false;
      return;
    }

    this.http.get<Meeting[]>('http://localhost:5125/api/meetings', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).subscribe({
      next: (meetings) => {
        // Ensure invitees is always an array
        this.items = meetings.map(meeting => ({
          ...meeting,
          invitees: meeting.invitees || []
        }));
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Toplantılar yüklenirken bir hata oluştu';
        this.loading = false;
        console.error('Error loading meetings:', err);
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'scheduled':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'canceled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case 'done':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'scheduled':
        return 'Planlandı';
      case 'canceled':
        return 'İptal Edildi';
      case 'done':
        return 'Tamamlandı';
      default:
        return 'Bilinmiyor';
    }
  }

  editMeeting(meeting: Meeting) {
    // TODO: Implement edit functionality
    console.log('Edit meeting:', meeting);
  }

  deleteMeeting(meeting: Meeting) {
    if (confirm(`${meeting.title} toplantısını silmek istediğinizden emin misiniz?`)) {
      const token = this.auth.getToken();
      if (!token) return;

      this.http.delete(`http://localhost:5125/api/meetings/${meeting.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }).subscribe({
        next: () => {
          this.loadMeetings(); // Reload the list
        },
        error: (err) => {
          this.error = 'Toplantı silinirken bir hata oluştu';
          console.error('Error deleting meeting:', err);
        }
      });
    }
  }
}
