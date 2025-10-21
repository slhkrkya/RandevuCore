import { Component, Input, ViewChild, ViewChildren, QueryList, ElementRef, OnInit, OnDestroy, ChangeDetectorRef, OnChanges, SimpleChanges, AfterViewInit, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { SignalRService } from '../../../../core/services/signalr';
import { AppConfigService } from '../../../../core/services/app-config.service';
import { AuthService } from '../../../../core/services/auth';
import { Participant, MeetingState } from '../meeting-room';
import { ParticipantService } from '../services/participant.service';
import { ParticipantVolumeService } from '../../../../core/services/participant-volume.service';

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
  backgroundImage?: string;
  uploadedDocument?: UploadedDocument;
  pdfDocument?: PdfDocumentInfo;
}

interface UploadedDocument {
  id: string;
  originalFileName: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadPath: string;
  userId: string;
  userName: string;
  timestamp: string;
}

interface PdfDocumentInfo {
  document: UploadedDocument;
  pdf: any;
  numPages: number;
  maxWidth: number;
  totalHeight: number;
  pageWidths: number[];
  pageHeights: number[];
  scale: number;
}

@Component({
  selector: 'app-whiteboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './whiteboard.html',
  styleUrls: ['./whiteboard.css']
})
export class WhiteboardComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit, AfterViewChecked {
  @Input() isActive = false;
  @Input() isHost = false;
  @Input() roomKey = '';
  @Input() currentUserId = '';
  @Input() localStream?: MediaStream | null;
  @Input() remoteStreams: Map<string, MediaStream> | null = new Map();
  @Input() meetingState: MeetingState | null = {
    isMuted: false,
    isVideoOn: false,
    isScreenSharing: false,
    isWhiteboardActive: false
  };

  @ViewChild('whiteboardCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('colorPicker', { static: true }) colorPicker!: ElementRef<HTMLInputElement>;
  @ViewChild('fileInput', { static: false }) fileInput!: ElementRef<HTMLInputElement>;
  
  // Audio elements for remote participants
  @ViewChildren('remoteAudio') remoteAudios!: QueryList<ElementRef<HTMLAudioElement>>;

  // Make Math available in template
  Math = Math;

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

  // Document management
  showDocumentUpload = false;
  showDownloadOptions = false;
  uploadingDocument = false;
  uploadProgress = 0;
  errorMessage = '';

  // Line width menu management
  showLineWidthMenu = false;
  lineWidthMenuPosition = { x: 0, y: 0 };
  private menuCloseTimeout: any = null;

  // Debounce for clear operation
  private clearTimeout?: any;

  // Participants and audio management
  participants: Participant[] = [];
  private participantsSubscription?: any;
  
  // Audio update management
  private audioUpdateScheduled = false;
  private changeDetectionScheduled = false;

  // Drawing tools
  colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFFFFF'
  ];
  
  lineWidths = [1, 2, 3, 5, 8, 12];
  
  tools = [
    { name: 'pen', icon: 'draw', color: '#3b82f6' },
    { name: 'eraser', icon: 'auto_fix_high', color: '#ef4444' },
    { name: 'upload', icon: 'folder_open', color: '#10b981' },
    { name: 'download', icon: 'save', color: '#8b5cf6' }
  ];

  currentTool = 'pen';

  constructor(
    private signalr: SignalRService,
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
    private appConfig: AppConfigService,
    private auth: AuthService,
    private participantService: ParticipantService,
    public participantVolume: ParticipantVolumeService
  ) {}

  ngAfterViewInit() {
    // Clear all remote audio elements AFTER ViewChild is initialized
    if (this.remoteAudios) {
      this.remoteAudios.forEach(audioRef => {
        const el = audioRef.nativeElement;
        el.pause();
        el.srcObject = null;
        el.load();
      });
    }
    
    this.scheduleChangeDetection();
  }

  ngOnInit() {
    this.initializeCanvas();
    this.setupSignalRListeners();
    this.updateHostPermissions();
    
    // Subscribe to participant service updates
    this.participantsSubscription = this.participantService.participants$.subscribe(participants => {
      this.participants = participants;
      this.scheduleChangeDetection();
    });
    this.initializePdfJs();
  }

  ngAfterViewChecked() {
    if (!this.remoteAudios || this.audioUpdateScheduled) return;
    
    this.audioUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.updateAudioElements();
      this.audioUpdateScheduled = false;
      
      // Force change detection for audio elements
      this.cdr.markForCheck();
    });
  }

  private async initializePdfJs() {
    try {
      // Configure PDF.js worker dynamically
      const pdfjsLib = await import('pdfjs-dist');
      // Use CDN worker for now
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    } catch (error) {
      console.error('PDF.js yükleme hatası:', error);
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['isHost']) {
      this.updateHostPermissions();
    }
  }

  private updateHostPermissions() {
    // Host automatically gets drawing permission
    if (this.isHost) {
      this.whiteboardState.canDraw = true;
      this.cdr.markForCheck();
      console.log('Host çizim izni aktif');
    } else {
      // Non-host users start with drawing permission disabled
      // They need to request permission from host
      this.whiteboardState.canDraw = false;
      this.cdr.markForCheck();
      console.log('Kullanıcı çizim izni pasif');
    }
  }

  ngOnDestroy() {
    // Cleanup timeout
    if (this.clearTimeout) {
      clearTimeout(this.clearTimeout);
    }
    
    // Cleanup participants subscription
    this.participantsSubscription?.unsubscribe();
    
    // Clear all audio elements on destroy
    if (this.remoteAudios) {
      this.remoteAudios.forEach(audioRef => {
        const el = audioRef.nativeElement;
        el.pause();
        el.srcObject = null;
        el.load();
      });
    }
  }

  private initializeCanvas() {
    if (this.canvas) {
      this.ctx = this.canvas.nativeElement.getContext('2d') || undefined;
      if (this.ctx) {
        // Set canvas to standard A4 PDF size (595.28 x 841.89 points)
        // Using 1.5 scale for better visibility
        const scale = 1.5;
        this.canvas.nativeElement.width = 595.28 * scale; // ~893px
        this.canvas.nativeElement.height = 841.89 * scale; // ~1263px
        
        console.log('Canvas standart A4 boyutunda ayarlandı:', {
          width: this.canvas.nativeElement.width,
          height: this.canvas.nativeElement.height,
          scale: scale
        });
        
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
      this.clearCanvasWithoutConfirmation();
    });

    // Listen for permission changes
    this.signalr.on<any>('whiteboard-permission', (permission) => {
      // Check if this permission is for the current user
      const currentUserId = this.auth.getCurrentUserId();
      if (permission.targetUserId === currentUserId) {
        this.whiteboardState.canDraw = permission.canDraw;
        this.cdr.markForCheck();
        console.log('Çizim izni güncellendi:', permission.canDraw);
      }
    });

    // Listen for document upload events
    this.signalr.on<any>('whiteboard-document-uploaded', (message) => {
      console.log('SignalR document uploaded:', message);
      // Extract the actual document from the payload
      const document = message.payload || message;
      this.handleDocumentUploaded(document);
    });

    // Listen for document removal events
    this.signalr.on<any>('whiteboard-document-removed', () => {
      this.handleDocumentRemoved();
    });

    // Listen for permission requests (host only)
    this.signalr.on<any>('whiteboard-permission-request', (request) => {
      if (this.isHost) {
        this.handlePermissionRequest(request);
      }
    });
  }

  // Mouse events
  onMouseDown(event: MouseEvent) {
    if (!this.whiteboardState.canDraw || !this.ctx) return;

    if (this.currentTool === 'pen' || this.currentTool === 'eraser') {
      const coords = this.getCanvasCoordinates(event);
      this.lastX = coords.x;
      this.lastY = coords.y;
      this.isDrawing = true;
      
      if (this.currentTool === 'pen') {
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        
        // Send the starting point
        this.sendDrawingData({
          x: this.lastX,
          y: this.lastY,
          isStart: true,
          color: this.whiteboardState.currentColor,
          lineWidth: this.whiteboardState.currentLineWidth
        });
      }
    }
  }

  onMouseMove(event: MouseEvent) {
    if (!this.whiteboardState.canDraw || !this.ctx) return;

    if (this.isDrawing && (this.currentTool === 'pen' || this.currentTool === 'eraser')) {
      const coords = this.getCanvasCoordinates(event);
      const currentX = coords.x;
      const currentY = coords.y;
      
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
  }

  onMouseUp() {
    if (this.isDrawing) {
      this.isDrawing = false;
      
      if (this.currentTool === 'pen') {
        this.ctx?.beginPath();
      }
    }
  }

  private getCanvasCoordinates(event: MouseEvent): { x: number, y: number } {
    const canvasElement = this.canvas.nativeElement;
    const rect = canvasElement.getBoundingClientRect();
    
    // Get mouse position relative to the canvas element
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Get the actual canvas dimensions
    const canvasWidth = canvasElement.width;
    const canvasHeight = canvasElement.height;
    
    // Get the displayed canvas size
    const displayedWidth = rect.width;
    const displayedHeight = rect.height;
    
    // Calculate the scale factor between displayed size and actual canvas size
    const scaleX = canvasWidth / displayedWidth;
    const scaleY = canvasHeight / displayedHeight;
    
    // Convert mouse coordinates to canvas coordinates
    const canvasX = mouseX * scaleX;
    const canvasY = mouseY * scaleY;
    
    return { x: canvasX, y: canvasY };
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
    
    // Update cursor based on tool
    if (this.canvas) {
      const canvasElement = this.canvas.nativeElement;
      switch (tool) {
        case 'pen':
          canvasElement.style.cursor = 'crosshair';
          break;
        case 'eraser':
          canvasElement.style.cursor = 'crosshair';
          break;
        default:
          canvasElement.style.cursor = 'default';
      }
    }
    
    // Handle special tool actions
    if (tool === 'upload') {
      this.showDocumentUpload = true;
    } else if (tool === 'download') {
      this.showDownloadOptions = true;
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

    // Ask for confirmation with appropriate message
    const message = this.whiteboardState.uploadedDocument 
      ? 'PDF üzerindeki çizimleri temizlemek istediğinizden emin misiniz? Bu işlem geri alınamaz.'
      : 'Beyaz tahtayı temizlemek istediğinizden emin misiniz? Bu işlem geri alınamaz.';
    
    if (!confirm(message)) {
      return;
    }

    this.clearCanvasWithoutConfirmation();
    
    // Send clear event to other participants
    this.signalr.sendToRoom(this.roomKey, 'whiteboard-clear', {});
  }

  private clearCanvasWithoutConfirmation() {
    if (!this.ctx) return;

    // Clear any existing timeout
    if (this.clearTimeout) {
      clearTimeout(this.clearTimeout);
    }

    // Debounce the clear operation
    this.clearTimeout = setTimeout(() => {
      // Clear drawings array
      this.whiteboardState.drawings = [];
      
      // If there's a PDF, reload it to clear drawings
      if (this.whiteboardState.uploadedDocument) {
        this.loadDocumentAsBackground(this.whiteboardState.uploadedDocument);
      } else {
        // If no PDF, just clear with white background
        this.ctx!.fillStyle = '#ffffff';
        this.ctx!.fillRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);
      }
      
      // Don't send SignalR message here - this is called from SignalR listener
    }, 100); // 100ms debounce
  }

  // SignalR communication
  private sendDrawingData(point: DrawingPoint) {
    // Only send if actually drawing
    if (!this.isDrawing) return;
    
    // Add to local drawings array
    this.whiteboardState.drawings.push(point);
    
    // Send to other participants
    this.signalr.sendToRoom(this.roomKey, 'whiteboard-draw', {
      ...point,
      timestamp: Date.now()
    });
  }

  private handleRemoteDrawing(data: any) {
    if (!this.ctx) return;

    // Extract the actual drawing data from payload
    const drawingData = data.payload || data;

    this.ctx.strokeStyle = drawingData.color;
    this.ctx.lineWidth = drawingData.lineWidth;

    if (drawingData.isStart) {
      this.ctx.beginPath();
      this.ctx.moveTo(drawingData.x, drawingData.y);
    } else {
      this.ctx.lineTo(drawingData.x, drawingData.y);
      this.ctx.stroke();
    }

    // Add to local drawings array (for PDF export)
    this.whiteboardState.drawings.push({
      x: drawingData.x,
      y: drawingData.y,
      isStart: drawingData.isStart,
      color: drawingData.color,
      lineWidth: drawingData.lineWidth
    });
  }

  // Permission management
  async requestDrawingPermission() {
    if (this.isHost) return; // Host doesn't need to request permission
    
    const userId = this.auth.getCurrentUserId();
    const userName = this.auth.getCurrentUserName();
    
    if (!userId) {
      console.error('Kullanıcı ID bulunamadı');
      return;
    }
    
    // Send permission request to host via backend
    await this.signalr.invoke('RequestWhiteboardPermission', this.roomKey, userId, userName);
    
    console.log('Çizim izni istendi');
  }

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

  // Document management methods
  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      // Check if file is PDF
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Sadece PDF dosyaları yüklenebilir. Lütfen PDF formatında bir dosya seçin.');
        return;
      }
      
      this.uploadDocument(file);
    }
  }

  async uploadDocument(file: File) {
    if (!file) return;

    // Validate file type - only PDF allowed
    if (file.type !== 'application/pdf') {
      this.errorMessage = 'Sadece PDF dosyaları yüklenebilir. Lütfen PDF formatında bir dosya seçin.';
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      this.errorMessage = 'Dosya boyutu 10MB\'dan büyük olamaz.';
      return;
    }

    this.uploadingDocument = true;
    this.uploadProgress = 0;
    this.errorMessage = '';

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('roomId', this.roomKey);

      const token = this.auth.getToken();
      if (!token) {
        throw new Error('Authentication token not found');
      }

      const response = await this.http.post<any>(`${this.appConfig.apiBaseUrl}/api/file/upload`, formData, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }).toPromise();

      if (response) {
        console.log('Dosya yükleme response:', response);
        console.log('Response fileType:', response.fileType);
        console.log('Response fileSize:', response.fileSize);
        
        this.whiteboardState.uploadedDocument = response;
        await this.loadDocumentAsBackground(response);
        
        // Notify other participants
        await this.signalr.sendToRoom(this.roomKey, 'whiteboard-document-uploaded', response);
        
        this.showDocumentUpload = false;
        this.uploadingDocument = false;
      }
    } catch (error: any) {
      console.error('Document upload error:', error);
      this.errorMessage = error.error?.message || 'Dosya yüklenirken bir hata oluştu.';
      this.uploadingDocument = false;
    }
  }

  private async loadDocumentAsBackground(document: UploadedDocument) {
    if (!this.ctx) return;

    try {
      console.log('Doküman yükleniyor:', document);
      console.log('Document fileType:', document.fileType);
      
      // Check if fileType exists and is a string
      if (!document.fileType || typeof document.fileType !== 'string') {
        console.error('Invalid fileType:', document.fileType);
        this.drawDocumentPlaceholder(document);
        return;
      }
      
      // For PDF files, load and render them using PDF.js
      if (document.fileType === '.pdf') {
        console.log('PDF dosyası tespit edildi');
        await this.loadPdfAsBackground(document);
      } else if (document.fileType.match(/\.(jpg|jpeg|png|gif)$/)) {
        console.log('Resim dosyası tespit edildi');
        // For images, load and draw them
        await this.loadImageAsBackground(document);
      } else {
        console.log('Diğer dosya türü tespit edildi');
        // For other document types, show a placeholder
        this.drawDocumentPlaceholder(document);
      }
    } catch (error) {
      console.error('Error loading document as background:', error);
    }
  }

  private async loadPdfAsBackground(document: UploadedDocument) {
    try {
      console.log('PDF yükleniyor:', document);
      
      // Download the PDF file
      const token = this.auth.getToken();
      const downloadUrl = `${this.appConfig.apiBaseUrl}/api/file/download/${this.roomKey}/${document.fileName}`;
      console.log('Download URL:', downloadUrl);
      
      const response = await this.http.get(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        responseType: 'arraybuffer'
      }).toPromise();

      if (response) {
        console.log('PDF dosyası indirildi, boyut:', response.byteLength);
        
        const pdfjsLib = await import('pdfjs-dist');
        console.log('PDF.js yüklendi');
        
        const pdf = await pdfjsLib.getDocument(response).promise;
        console.log('PDF dokümanı yüklendi, sayfa sayısı:', pdf.numPages);
        
        // Get all pages
        const numPages = pdf.numPages;
        console.log('PDF sayfa sayısı:', numPages);
        
        // Calculate total height for all pages
        let totalHeight = 0;
        const pageWidths: number[] = [];
        const pageHeights: number[] = [];
        
        // Get dimensions for all pages
        for (let i = 1; i <= numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          pageWidths.push(viewport.width);
          pageHeights.push(viewport.height);
          totalHeight += viewport.height;
        }
        
        // Use the maximum width
        const maxWidth = Math.max(...pageWidths);
        
        console.log('PDF boyutları:', {
          numPages,
          maxWidth,
          totalHeight,
          pageWidths,
          pageHeights
        });
        
        // Set canvas size to accommodate all pages
        const canvasElement = this.canvas.nativeElement;
        canvasElement.width = maxWidth;
        canvasElement.height = totalHeight;
        
        // Update canvas context
        this.ctx = canvasElement.getContext('2d') || undefined;
        
        console.log('Canvas tüm sayfalar için ayarlandı:', {
          width: maxWidth,
          height: totalHeight
        });
        
        // Clear canvas first
        if (this.ctx) {
          this.ctx.clearRect(0, 0, maxWidth, totalHeight);
        }
        
        // Render all pages
        let currentY = 0;
        for (let i = 1; i <= numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          
          // Center the page horizontally if it's narrower than max width
          const offsetX = (maxWidth - viewport.width) / 2;
          
          const renderContext = {
            canvasContext: this.ctx!,
            viewport: viewport,
            transform: [1, 0, 0, 1, offsetX, currentY] // Translate to position
          };
          
          console.log(`Sayfa ${i} render ediliyor...`, {
            offsetX, currentY,
            width: viewport.width,
            height: viewport.height
          });
          
          await page.render(renderContext).promise;
          currentY += viewport.height;
        }
        
        console.log('Tüm sayfalar render edildi');
        
        // Store PDF info for download
        this.whiteboardState.pdfDocument = {
          document: document,
          pdf: pdf,
          numPages: numPages,
          maxWidth: maxWidth,
          totalHeight: totalHeight,
          pageWidths: pageWidths,
          pageHeights: pageHeights,
          scale: 1 // No scaling
        };
        
        console.log('PDF state güncellendi');
      }
    } catch (error) {
      console.error('PDF yükleme hatası:', error);
      this.drawPdfPlaceholder(document);
    }
  }

  private drawPdfPlaceholder(document: UploadedDocument) {
    if (!this.ctx) return;

    // Clear canvas
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);

    // Draw PDF placeholder
    this.ctx.fillStyle = '#f3f4f6';
    this.ctx.fillRect(50, 50, this.canvas.nativeElement.width - 100, this.canvas.nativeElement.height - 100);

    this.ctx.fillStyle = '#374151';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('📄 PDF Document', this.canvas.nativeElement.width / 2, this.canvas.nativeElement.height / 2 - 20);
    
    this.ctx.font = '16px Arial';
    this.ctx.fillText(document.originalFileName, this.canvas.nativeElement.width / 2, this.canvas.nativeElement.height / 2 + 10);
    
    this.ctx.font = '14px Arial';
    this.ctx.fillText('You can draw on top of this document', this.canvas.nativeElement.width / 2, this.canvas.nativeElement.height / 2 + 40);
  }

  private drawDocumentPlaceholder(document: UploadedDocument) {
    if (!this.ctx) return;

    // Clear canvas
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);

    // Draw document placeholder
    this.ctx.fillStyle = '#f3f4f6';
    this.ctx.fillRect(50, 50, this.canvas.nativeElement.width - 100, this.canvas.nativeElement.height - 100);

    this.ctx.fillStyle = '#374151';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    
    let icon = '📄';
    // Safe fileType check
    if (document.fileType && typeof document.fileType === 'string') {
      if (document.fileType.match(/\.(doc|docx)$/)) icon = '📝';
      else if (document.fileType.match(/\.(xls|xlsx)$/)) icon = '📊';
      else if (document.fileType.match(/\.(ppt|pptx)$/)) icon = '📈';
    }
    
    this.ctx.fillText(icon + ' Document', this.canvas.nativeElement.width / 2, this.canvas.nativeElement.height / 2 - 20);
    
    this.ctx.font = '16px Arial';
    this.ctx.fillText(document.originalFileName || 'Unknown File', this.canvas.nativeElement.width / 2, this.canvas.nativeElement.height / 2 + 10);
    
    this.ctx.font = '14px Arial';
    this.ctx.fillText('You can draw on top of this document', this.canvas.nativeElement.width / 2, this.canvas.nativeElement.height / 2 + 40);
  }

  private async loadImageAsBackground(document: UploadedDocument) {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        if (!this.ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        // Clear canvas
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);

        // Calculate scaling to fit image in canvas
        const canvasWidth = this.canvas.nativeElement.width;
        const canvasHeight = this.canvas.nativeElement.height;
        const imgWidth = img.width;
        const imgHeight = img.height;

        const scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
        const scaledWidth = imgWidth * scale;
        const scaledHeight = imgHeight * scale;

        const x = (canvasWidth - scaledWidth) / 2;
        const y = (canvasHeight - scaledHeight) / 2;

        this.ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
        resolve();
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      img.src = `${this.appConfig.apiBaseUrl}/${document.uploadPath}`;
    });
  }

  private handleDocumentUploaded(document: UploadedDocument) {
    console.log('handleDocumentUploaded called with:', document);
    console.log('Document fileType:', document?.fileType);
    console.log('Document fileSize:', document?.fileSize);
    
    this.whiteboardState.uploadedDocument = document;
    this.loadDocumentAsBackground(document);
    this.cdr.markForCheck();
  }

  private handleDocumentRemoved() {
    // Clear all drawings
    this.whiteboardState.drawings = [];
    this.whiteboardState.uploadedDocument = undefined;
    this.whiteboardState.backgroundImage = undefined;
    this.whiteboardState.pdfDocument = undefined;
    
    // Reset canvas to default A4 size
    this.initializeCanvas();
    
    this.cdr.markForCheck();
  }

  private handlePermissionRequest(request: any) {
    if (!this.isHost) return;
    
    const requesterName = request.requesterName || 'Kullanıcı';
    const requesterId = request.requesterId;
    
    // Show confirmation dialog
    const confirmed = confirm(`${requesterName} beyaz tahtada çizim yapmak için izin istiyor. İzin vermek istiyor musunuz?`);
    
    if (confirmed) {
      // Grant permission via backend method
      this.signalr.invoke('GrantWhiteboardPermission', this.roomKey, requesterId);
      
      console.log(`${requesterName} için çizim izni verildi`);
    }
  }

  removeDocument() {
    if (!this.isHost) return;
    
    // Clear all drawings
    this.whiteboardState.drawings = [];
    this.whiteboardState.uploadedDocument = undefined;
    this.whiteboardState.backgroundImage = undefined;
    this.whiteboardState.pdfDocument = undefined;
    
    // Reset canvas to default A4 size
    this.initializeCanvas();
    
    // Notify other participants
    this.signalr.sendToRoom(this.roomKey, 'whiteboard-document-removed', {});
    
    console.log('PDF kaldırıldı ve sayfa sıfırlandı');
  }

  async downloadWhiteboard() {
    if (!this.canvas) return;

    // If there's a PDF document, create a PDF with annotations
    if (this.whiteboardState.pdfDocument) {
      await this.downloadPdfWithAnnotations();
    } else {
      // Download as image (existing functionality)
      this.downloadAsImage();
    }
  }

  private async downloadPdfWithAnnotations() {
    try {
      const pdfDoc = this.whiteboardState.pdfDocument!;
      
      // Get PDF bytes from the original PDF.js document
      const pdfBytes = await pdfDoc.pdf.getData();
      
      // Create a new PDF document with pdf-lib
      const { PDFDocument, rgb } = await import('pdf-lib');
      const newPdfDoc = await PDFDocument.load(pdfBytes);
      
      // Get all pages
      const pages = newPdfDoc.getPages();
      const numPages = pdfDoc.numPages;
      
      // Get canvas dimensions
      const canvasWidth = this.canvas.nativeElement.width;
      const canvasHeight = this.canvas.nativeElement.height;
      
      console.log('PDF boyutları:', {
        numPages,
        canvasWidth, canvasHeight,
        pageWidths: pdfDoc.pageWidths,
        pageHeights: pdfDoc.pageHeights
      });
      
      // No scale validation needed since canvas = PDF size
      
      // Draw annotations on the PDF page
      const annotations = this.whiteboardState.drawings;
      console.log('Çizimler PDF\'e ekleniyor:', annotations.length, 'çizim');
      
      // Filter out invalid drawing points
      const validAnnotations = annotations.filter(point => 
        typeof point.x === 'number' && typeof point.y === 'number' &&
        !isNaN(point.x) && !isNaN(point.y) && 
        isFinite(point.x) && isFinite(point.y)
      );
      
      console.log('Geçerli çizimler:', validAnnotations.length, 'çizim');
      
      if (validAnnotations.length === 0) {
        console.log('Geçerli çizim bulunamadı, sadece PDF indiriliyor');
      }
      
      // Group drawings by stroke (consecutive points)
      const strokes: DrawingPoint[][] = [];
      let currentStroke: DrawingPoint[] = [];
      
      for (let i = 0; i < validAnnotations.length; i++) {
        const point = validAnnotations[i];
        
        if (point.isStart) {
          // Start a new stroke
          if (currentStroke.length > 0) {
            strokes.push([...currentStroke]);
          }
          currentStroke = [point];
        } else {
          // Continue current stroke
          currentStroke.push(point);
        }
      }
      
      // Add the last stroke
      if (currentStroke.length > 0) {
        strokes.push(currentStroke);
      }
      
      console.log('Gruplandırılmış çizimler:', strokes.length, 'stroke');
      
      // Draw each stroke
      for (const stroke of strokes) {
        if (stroke.length < 2) continue; // Skip single points
        
        for (let i = 1; i < stroke.length; i++) {
          const prevPoint = stroke[i - 1];
          const currentPoint = stroke[i];
          
          // Determine which page this drawing is on
          let pageIndex = 0;
          let currentY = 0;
          
          for (let p = 0; p < numPages; p++) {
            const pageHeight = pdfDoc.pageHeights[p];
            if (prevPoint.y >= currentY && prevPoint.y < currentY + pageHeight) {
              pageIndex = p;
              break;
            }
            currentY += pageHeight;
          }
          
          // Get the target page
          const targetPage = pages[pageIndex];
          const pageWidth = pdfDoc.pageWidths[pageIndex];
          const pageHeight = pdfDoc.pageHeights[pageIndex];
          
          // Calculate offset for this page
          let pageOffsetY = 0;
          for (let p = 0; p < pageIndex; p++) {
            pageOffsetY += pdfDoc.pageHeights[p];
          }
          
          // Calculate page offset X (center if page is narrower)
          const pageOffsetX = (pdfDoc.maxWidth - pageWidth) / 2;
          
          // Convert canvas coordinates to page coordinates
          const startX = prevPoint.x - pageOffsetX;
          const startY = pageHeight - (prevPoint.y - pageOffsetY); // Flip Y coordinate
          const endX = currentPoint.x - pageOffsetX;
          const endY = pageHeight - (currentPoint.y - pageOffsetY); // Flip Y coordinate
          
          // Skip if any coordinate is NaN or invalid
          if (isNaN(startX) || isNaN(startY) || isNaN(endX) || isNaN(endY) ||
              !isFinite(startX) || !isFinite(startY) || !isFinite(endX) || !isFinite(endY)) {
            console.warn('Skipping invalid coordinates:', { 
              prevPoint, currentPoint,
              startX, startY, endX, endY 
            });
            continue;
          }
          
          // Skip if coordinates are outside page bounds
          if (startX < 0 || startY < 0 || endX < 0 || endY < 0 ||
              startX > pageWidth || startY > pageHeight ||
              endX > pageWidth || endY > pageHeight) {
            console.warn('Skipping out-of-bounds coordinates:', { 
              pageIndex, startX, startY, endX, endY,
              pageWidth, pageHeight 
            });
            continue;
          }
          
          targetPage.drawLine({
            start: { x: startX, y: startY },
            end: { x: endX, y: endY },
            thickness: Math.max(0.1, currentPoint.lineWidth),
            color: rgb(
              this.hexToRgb(currentPoint.color).r, 
              this.hexToRgb(currentPoint.color).g, 
              this.hexToRgb(currentPoint.color).b
            )
          });
        }
      }
      
      // Save the PDF
      const modifiedPdfBytes = await newPdfDoc.save();
      const blob = new Blob([new Uint8Array(modifiedPdfBytes)], { type: 'application/pdf' });
      
      // Download the PDF
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whiteboard-${pdfDoc.document.originalFileName}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('PDF indirme hatası:', error);
      // Fallback to image download
      this.downloadAsImage();
    }
  }

  downloadAsImage() {
    this.showDownloadOptions = false;
    // Create a temporary canvas with higher resolution
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) return;

    // Set higher resolution for better quality
    const scale = 2;
    tempCanvas.width = this.canvas.nativeElement.width * scale;
    tempCanvas.height = this.canvas.nativeElement.height * scale;

    // Scale the context
    tempCtx.scale(scale, scale);

    // Draw the whiteboard content
    tempCtx.drawImage(this.canvas.nativeElement, 0, 0);

    // Convert to blob and download
    tempCanvas.toBlob((blob) => {
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `whiteboard-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  private hexToRgb(hex: string) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 0, g: 0, b: 0 };
  }

  closeDocumentUpload() {
    this.showDocumentUpload = false;
    this.errorMessage = '';
    this.uploadProgress = 0;
  }

  closeDownloadOptions() {
    this.showDownloadOptions = false;
  }

  async downloadAsPdf() {
    this.showDownloadOptions = false;
    if (this.whiteboardState.uploadedDocument) {
      await this.downloadPdfWithAnnotations();
    } else {
      await this.downloadAsImage();
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getCurrentToolName(): string {
    const toolNames: { [key: string]: string } = {
      'pen': 'Kalem',
      'eraser': 'Silgi',
      'upload': 'Yükle',
      'download': 'İndir'
    };
    return toolNames[this.currentTool] || this.currentTool;
  }

  getToolTitle(toolName: string): string {
    const toolTitles: { [key: string]: string } = {
      'pen': 'Kalem - Çizim yapmak için',
      'eraser': 'Silgi - Çizimleri silmek için',
      'upload': 'Dosya Yükle - PDF dosyası yüklemek için',
      'download': 'İndir - Çizimleri kaydetmek için'
    };
    return toolTitles[toolName] || toolName;
  }

  getColorTitle(color: string): string {
    const colorNames: { [key: string]: string } = {
      '#000000': 'Siyah',
      '#FF0000': 'Kırmızı',
      '#00FF00': 'Yeşil',
      '#0000FF': 'Mavi',
      '#FFFF00': 'Sarı',
      '#FF00FF': 'Magenta',
      '#00FFFF': 'Cyan',
      '#FFFFFF': 'Beyaz'
    };
    return colorNames[color] || color;
  }

  getLineWidthTitle(width: number): string {
    return `${width}px kalınlık - Çizgi kalınlığını ayarlamak için`;
  }

  onToolHover(event: MouseEvent, toolName: string) {
    if (toolName === 'pen') {
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      this.lineWidthMenuPosition = {
        x: rect.right - 2,  // Negatif değer - menü ikonun üzerine gelsin
        y: rect.top + (rect.height / 2) - 150 // İkonun tam ortası
      };
      this.showLineWidthMenu = true;
    }
  }

  onToolLeave() {
    // Delay hiding to allow moving to menu - çok daha uzun süre bekle
    this.menuCloseTimeout = setTimeout(() => {
      this.showLineWidthMenu = false;
      this.menuCloseTimeout = null;
    }, 500); 
  }

  onMenuEnter() {
    // Menüye girildiğinde menüyü açık tut ve tüm timeout'ları temizle
    this.showLineWidthMenu = true;
    // Eğer varsa, kapanma timeout'unu iptal et
    if (this.menuCloseTimeout) {
      clearTimeout(this.menuCloseTimeout);
      this.menuCloseTimeout = null;
    }
  }

  onMenuLeave() {
    // Menüden çıkıldığında hemen kapatma - kısa bir delay ekle
    this.menuCloseTimeout = setTimeout(() => {
      this.showLineWidthMenu = false;
      this.menuCloseTimeout = null;
    }, 200); // 100ms'den 200ms'ye çıkardık
  }

  // ===== Audio Management Methods =====
  
  // Single change detection per component
  private scheduleChangeDetection() {
    if (this.changeDetectionScheduled) return;
    
    this.changeDetectionScheduled = true;
    requestAnimationFrame(() => {
      this.cdr.detectChanges();
      this.changeDetectionScheduled = false;
    });
  }
  
  // Update audio elements for all participants
  private updateAudioElements() {
    if (!this.remoteAudios) return;
    
    this.remoteAudios.forEach(audioRef => {
      const audioElement = audioRef.nativeElement;
      const userId = audioElement.getAttribute('data-user-id');
      
      if (!userId) return;
      
      let stream: MediaStream | undefined;
      if (userId === this.currentUserId) {
        stream = this.localStream || undefined;
      } else {
        stream = this.remoteStreams?.get(userId);
      }
      
      if (stream && stream.getAudioTracks().length > 0) {
        if (audioElement.srcObject !== stream) {
          audioElement.srcObject = stream;
          audioElement.play().catch(() => {});
        }
        // Apply per-user volume (0..1)
        const vol = this.participantVolume.getVolume(userId);
        audioElement.volume = vol;
      } else if (audioElement.srcObject) {
        audioElement.srcObject = null;
      }
    });
  }
  
  // Track by userId for ngFor
  trackByUserId(index: number, item: Participant) {
    return item.userId;
  }
}