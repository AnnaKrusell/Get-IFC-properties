import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

// 3rd party
import { AngularSplitModule } from 'angular-split';
import { IfcViewerModule } from 'ngx-ifc-viewer';
import { MatButtonModule } from '@angular/material/button';
import { LBDParsersModule } from 'ngx-lbd-parsers';
// import { ComunicaModule } from 'ngx-comunica';
import { ComunicaModule } from 'src/app/3rdparty/comunica/comunica.module';


@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AngularSplitModule,
    IfcViewerModule,
    MatButtonModule,
    ComunicaModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
