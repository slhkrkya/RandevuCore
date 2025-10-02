import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Location } from '@angular/common';
import { SettingsPanelComponent } from '../../core/components/settings-panel/settings-panel.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, RouterModule, SettingsPanelComponent],
  templateUrl: './settings.html',
  styleUrls: ['./settings.css']
})
export class SettingsComponent {
  constructor(private location: Location) {}

  goBack() {
    this.location.back();
  }
}