import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-meeting-list',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe],
  templateUrl: './meeting-list.html',
  styleUrls: ['./meeting-list.css']
})
export class MeetingListComponent {
  items: any[] = [];
  constructor(private http: HttpClient) {
    this.http.get<any[]>('http://localhost:5125/api/meetings').subscribe(r => this.items = r);
  }
}
