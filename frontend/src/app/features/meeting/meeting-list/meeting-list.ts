import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth';
import { AppConfigService } from '../../../core/services/app-config.service';

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

interface User {
  id: string;
  name: string;
  email: string;
}

@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './meeting-list.html',
  styleUrls: ['./meeting-list.css']
})
export class MeetingListComponent implements OnInit {
  items: Meeting[] = [];
  users: User[] = [];
  loading = true;
  loadingUsers = false;
  error: string | null = null;
  selectedUserId: string | null = null;
  
  // Cache için
  private usersCache: User[] | null = null;
  private usersCacheTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 dakika

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private cfg: AppConfigService
  ) {}

  ngOnInit() {
    this.loadUsers();
    this.loadMeetings();
  }

  loadUsers() {
    // Cache kontrolü
    const now = Date.now();
    if (this.usersCache && (now - this.usersCacheTime) < this.CACHE_DURATION) {
      this.users = this.usersCache;
      return;
    }

    const token = this.auth.getToken();
    if (!token) return;

    this.loadingUsers = true;
    this.http.get<User[]>(`${this.cfg.apiBaseUrl || ''}/api/users`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }).subscribe({
      next: (users) => {
        this.users = users;
        this.usersCache = users;
        this.usersCacheTime = now;
        this.loadingUsers = false;
      },
      error: (err) => {
        console.error('Kullanıcılar yüklenirken hata:', err);
        this.loadingUsers = false;
      }
    });
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

    // Filtreleme parametresi ekle
    const params: any = {};
    if (this.selectedUserId && this.selectedUserId !== 'null') {
      params.filterByUserId = this.selectedUserId;
    }

    this.http.get<Meeting[]>(`${this.cfg.apiBaseUrl || ''}/api/meetings`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      params: params
    }).subscribe({
      next: (meetings) => {
        // Ensure invitees is always an array and sort by start time
        this.items = meetings.map(meeting => ({
          ...meeting,
          invitees: meeting.invitees || []
        })).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Toplantılar yüklenirken bir hata oluştu';
        this.loading = false;
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

      this.http.delete(`${this.cfg.apiBaseUrl || ''}/api/meetings/${meeting.id}`, {
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

  onUserFilterChange(userId: string | null) {
    this.selectedUserId = userId;
    this.loadMeetings();
  }

  clearFilter() {
    this.selectedUserId = null;
    this.loadMeetings();
  }
}
