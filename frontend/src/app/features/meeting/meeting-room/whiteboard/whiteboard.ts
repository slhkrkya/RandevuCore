import { Component, Input, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignalRService } from '../../../../core/services/signalr';

interface DrawingPoint {
  x: number;
  y: number;
  isStart: boolean;
  color: string;
  lineWidth: number;
}

interface WhiteboardState {
  isActive: boolean;
  canDraw: boolean;
  currentColor: string;
  currentLineWidth: number;
  drawings: DrawingPoint[];
}

@Component({
  selector: 'app-whiteboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './whiteboard.html',
  styleUrls: ['./whiteboard.css']
})
export class WhiteboardComponent implements OnInit, OnDestroy {
  @Input() isActive = false;
  @Input() isHost = false;
  @Input() roomKey = '';

  @ViewChild('whiteboardCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('colorPicker', { static: true }) colorPicker!: ElementRef<HTMLInputElement>;

  private ctx?: CanvasRenderingContext2D;
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;

  // Whiteboard state
  whiteboardState: WhiteboardState = {
    isActive: false,
    canDraw: false,
    currentColor: '#000000',
    currentLineWidth: 3,
    drawings: []
  };

  // Drawing tools
  colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFFFFF'
  ];
  
  lineWidths = [1, 2, 3, 5, 8, 12];
  
  tools = [
    { name: 'pen', icon: 'edit', color: '#3b82f6' },
    { name: 'eraser', icon: 'auto_fix_high', color: '#ef4444' },
    { name: 'clear', icon: 'clear_all', color: '#f59e0b' }
  ];

  currentTool = 'pen';

  constructor(private signalr: SignalRService) {}

  ngOnInit() {
    this.initializeCanvas();
    this.setupSignalRListeners();
  }

  ngOnDestroy() {
    // Cleanup if needed
  }

  private initializeCanvas() {
    if (this.canvas) {
      this.ctx = this.canvas.nativeElement.getContext('2d') || undefined;
      if (this.ctx) {
        this.canvas.nativeElement.width = 800;
        this.canvas.nativeElement.height = 600;
        this.setupCanvas();
      }
    }
  }

  private setupCanvas() {
    if (!this.ctx) return;

    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = this.whiteboardState.currentColor;
    this.ctx.lineWidth = this.whiteboardState.currentLineWidth;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);
  }

  private setupSignalRListeners() {
    // Listen for whiteboard drawing events
    this.signalr.on<any>('whiteboard-draw', (data) => {
      this.handleRemoteDrawing(data);
    });

    // Listen for whiteboard clear events
    this.signalr.on<any>('whiteboard-clear', () => {
      this.clearCanvas();
    });

    // Listen for permission changes
    this.signalr.on<any>('whiteboard-permission', (permission) => {
      this.whiteboardState.canDraw = permission.canDraw;
    });
  }

  // Mouse events
  onMouseDown(event: MouseEvent) {
    if (!this.whiteboardState.canDraw || !this.ctx) return;

    this.isDrawing = true;
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    this.lastX = event.clientX - rect.left;
    this.lastY = event.clientY - rect.top;

    if (this.currentTool === 'pen') {
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastX, this.lastY);
    }
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isDrawing || !this.whiteboardState.canDraw || !this.ctx) return;

    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    if (this.currentTool === 'pen') {
      this.ctx.lineTo(currentX, currentY);
      this.ctx.stroke();

      // Send drawing data to other participants
      this.sendDrawingData({
        x: currentX,
        y: currentY,
        isStart: false,
        color: this.whiteboardState.currentColor,
        lineWidth: this.whiteboardState.currentLineWidth
      });
    } else if (this.currentTool === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.beginPath();
      this.ctx.arc(currentX, currentY, this.whiteboardState.currentLineWidth * 2, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalCompositeOperation = 'source-over';
    }

    this.lastX = currentX;
    this.lastY = currentY;
  }

  onMouseUp() {
    if (!this.isDrawing) return;

    this.isDrawing = false;
    
    if (this.currentTool === 'pen') {
      this.ctx?.beginPath();
    }
  }

  // Touch events for mobile
  onTouchStart(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.onMouseDown(mouseEvent);
  }

  onTouchMove(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    this.onMouseMove(mouseEvent);
  }

  onTouchEnd(event: TouchEvent) {
    event.preventDefault();
    this.onMouseUp();
  }

  // Tool selection
  selectTool(tool: string) {
    this.currentTool = tool;
    
    if (tool === 'clear') {
      this.clearCanvas();
    }
  }

  selectColor(color: string) {
    this.whiteboardState.currentColor = color;
    if (this.ctx) {
      this.ctx.strokeStyle = color;
    }
  }

  selectLineWidth(width: number) {
    this.whiteboardState.currentLineWidth = width;
    if (this.ctx) {
      this.ctx.lineWidth = width;
    }
  }

  // Canvas operations
  clearCanvas() {
    if (!this.ctx) return;

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);
    
    // Send clear event to other participants
    this.signalr.sendToRoom(this.roomKey, 'whiteboard-clear', {});
  }

  // SignalR communication
  private sendDrawingData(point: DrawingPoint) {
    this.signalr.sendToRoom(this.roomKey, 'whiteboard-draw', {
      ...point,
      timestamp: Date.now()
    });
  }

  private handleRemoteDrawing(data: any) {
    if (!this.ctx) return;

    this.ctx.strokeStyle = data.color;
    this.ctx.lineWidth = data.lineWidth;

    if (data.isStart) {
      this.ctx.beginPath();
      this.ctx.moveTo(data.x, data.y);
    } else {
      this.ctx.lineTo(data.x, data.y);
      this.ctx.stroke();
    }
  }

  // Permission management
  async grantDrawingPermission(userId: string) {
    if (!this.isHost) return;

    await this.signalr.sendToRoom(this.roomKey, 'whiteboard-permission', {
      targetUserId: userId,
      canDraw: true
    });
  }

  async revokeDrawingPermission(userId: string) {
    if (!this.isHost) return;

    await this.signalr.sendToRoom(this.roomKey, 'whiteboard-permission', {
      targetUserId: userId,
      canDraw: false
    });
  }

  // Utility methods
  getToolIcon(tool: string): string {
    const toolObj = this.tools.find(t => t.name === tool);
    return toolObj?.icon || 'edit';
  }

  getToolColor(tool: string): string {
    const toolObj = this.tools.find(t => t.name === tool);
    return toolObj?.color || '#3b82f6';
  }

  isToolActive(tool: string): boolean {
    return this.currentTool === tool;
  }

  isColorActive(color: string): boolean {
    return this.whiteboardState.currentColor === color;
  }

  isLineWidthActive(width: number): boolean {
    return this.whiteboardState.currentLineWidth === width;
  }
}