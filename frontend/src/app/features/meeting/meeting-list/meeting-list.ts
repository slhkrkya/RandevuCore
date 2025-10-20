import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth';
import { AppConfigService } from '../../../core/services/app-config.service';
import { MeetingStatusService } from '../../../core/services/meeting-status.service';

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
  creatorName: string;
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
  
  // Edit modal için
  showEditModal = false;
  editingMeeting: Meeting | null = null;
  editForm: any = {};
  editLoading = false;
  editError: string | null = null;
  
  // Cache için
  private usersCache: User[] | null = null;
  private usersCacheTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 dakika

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private cfg: AppConfigService,
    public meetingStatus: MeetingStatusService
  ) {}

  // Host kontrolü için helper method
  isHost(meeting: Meeting): boolean {
    const currentUserId = this.auth.getCurrentUserId();
    return currentUserId === meeting.creatorId;
  }

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
    this.editingMeeting = meeting;
    
    // Tarihleri yerel saat diliminde formatla
    const startsAt = new Date(meeting.startsAt);
    const endsAt = new Date(meeting.endsAt);
    
    this.editForm = {
      title: meeting.title,
      startsAt: this.formatDateTimeLocal(startsAt),
      endsAt: this.formatDateTimeLocal(endsAt),
      notes: meeting.notes || '',
      status: meeting.status,
      inviteeIds: meeting.invitees?.map(i => i.id) || []
    };
    this.editError = null;
    this.showEditModal = true;
  }

  // datetime-local input için tarih formatı
  private formatDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  closeEditModal() {
    this.showEditModal = false;
    this.editingMeeting = null;
    this.editForm = {};
    this.editError = null;
    this.editLoading = false;
  }

  saveMeeting() {
    if (!this.editingMeeting) return;
    
    this.editLoading = true;
    this.editError = null;
    
    const token = this.auth.getToken();
    if (!token) return;

    // Tarih validasyonu
    const startsAt = new Date(this.editForm.startsAt);
    const endsAt = new Date(this.editForm.endsAt);
    const now = new Date();
    
    if (startsAt < now) {
      this.editError = 'Toplantı başlangıç zamanı geçmiş bir tarih olamaz';
      this.editLoading = false;
      return;
    }
    
    if (startsAt >= endsAt) {
      this.editError = 'Başlangıç zamanı bitiş zamanından önce olmalıdır';
      this.editLoading = false;
      return;
    }

    const updateData = {
      title: this.editForm.title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notes: this.editForm.notes,
      status: this.editForm.status,
      inviteeIds: this.editForm.inviteeIds
    };

    this.http.put(`${this.cfg.apiBaseUrl || ''}/api/meetings/${this.editingMeeting.id}`, updateData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }).subscribe({
      next: () => {
        this.editLoading = false;
        this.closeEditModal();
        this.loadMeetings(); // Reload the list
      },
      error: (err) => {
        this.editError = err.error?.error || 'Toplantı güncellenirken bir hata oluştu';
        this.editLoading = false;
      }
    });
  }

  toggleInvitee(userId: string) {
    const index = this.editForm.inviteeIds.indexOf(userId);
    if (index > -1) {
      this.editForm.inviteeIds.splice(index, 1);
    } else {
      this.editForm.inviteeIds.push(userId);
    }
  }

  isInviteeSelected(userId: string): boolean {
    return this.editForm.inviteeIds?.includes(userId) || false;
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

  // Toplantı durumu kontrol metodları
  isCurrentlyInMeeting(): boolean {
    // Only consider active if not ended
    return this.meetingStatus.hasActiveMeeting;
  }

  isCurrentlyInThisMeeting(meetingId: string): boolean {
    const currentMeeting = this.meetingStatus.currentMeeting();
    if (!currentMeeting) return false;
    if (currentMeeting.isEnded) return false;
    return currentMeeting.meetingId === meetingId;
  }

  getCurrentMeetingStatus(meetingId: string): string {
    const currentMeeting = this.meetingStatus.currentMeeting();
    if (!currentMeeting) return '';
    if (currentMeeting.isEnded) return '';
    if (currentMeeting.meetingId === meetingId) {
      return currentMeeting.isBackground ? 'Arka planda devam ediyor' : 'Şu anda bu toplantıdasınız';
    }
    return 'Başka bir toplantıdasınız';
  }

  canJoinMeeting(meetingId: string): boolean {
    const currentMeeting = this.meetingStatus.currentMeeting();
    if (!currentMeeting || currentMeeting.isEnded) return true;
    // Aynı toplantıdaysa katılabilir
    if (currentMeeting.meetingId === meetingId) return true;
    // Farklı toplantıdaysa katılamaz
    return false;
  }

  getJoinRoute(meetingId: string): string[] {
    const currentMeeting = this.meetingStatus.currentMeeting();
    // Eğer zaten bu toplantıdaysa ve aktifse, direkt toplantıya git (pre-join olmadan)
    if (currentMeeting && !currentMeeting.isEnded && currentMeeting.meetingId === meetingId) {
      return ['/meetings', meetingId];
    }
    // Değilse pre-join'e git
    return ['/meetings', meetingId, 'prejoin'];
  }
}
