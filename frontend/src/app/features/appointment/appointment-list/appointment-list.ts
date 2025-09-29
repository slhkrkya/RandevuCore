import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-appointment-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './appointment-list.html',
  styleUrls: ['./appointment-list.css']
})
export class AppointmentList implements OnInit {
  items: any[] = [];
  loading = true;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadAppointments();
  }

  loadAppointments() {
    this.loading = true;
    const token = localStorage.getItem('token');
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    
    this.http.get<any[]>('http://localhost:5125/api/appointments', { headers })
      .subscribe({
        next: (items) => {
          this.items = items;
          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading appointments:', error);
          this.loading = false;
        }
      });
  }

  getDuration(startsAt: string, endsAt: string): number {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60)); // dakika cinsinden
  }

  editAppointment(appointment: any) {
    // Appointment düzenleme işlemi
    console.log('Edit appointment:', appointment);
  }

  deleteAppointment(appointment: any) {
    if (confirm('Bu randevuyu silmek istediğinizden emin misiniz?')) {
      const token = localStorage.getItem('token');
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
      
      this.http.delete(`http://localhost:5125/api/appointments/${appointment.id}`, { headers })
        .subscribe({
          next: () => {
            this.loadAppointments(); // Listeyi yenile
          },
          error: (error) => {
            console.error('Error deleting appointment:', error);
          }
        });
    }
  }
}
