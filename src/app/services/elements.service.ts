import { Injectable } from '@angular/core';
// import { ComunicaService } from 'ngx-comunica';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { Serialization, Source, SourceType, UpdateResult } from 'src/app/3rdparty/comunica/models';
import { WKTObject, WKTObjectOptions } from 'ngx-ifc-viewer';
import { lastValueFrom } from 'rxjs';
import { Space } from '../models';
import { AppComponent } from '../app.component';
import { UtilsService } from './utils.service';

@Injectable({
  providedIn: 'root',
})
export class ElementsService {
  public queryResult?: any;
  public queryComplete: boolean = false;

  constructor(
    private _comunica: ComunicaService,
    private _util: UtilsService
  ) {}

 
  async getWallProps(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ex: <https://example.com/>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    SELECT ?inst ?p ?o 
    WHERE { 
        ?inst a ifc:IfcWall .
        ?inst ?p ?o .
    } 
      
       `;

    const spaces = await lastValueFrom(this._comunica.selectQuery(query));
    return spaces.map((item: any) => {
      const URI = item.subclass.value;
      const name = item.inst.value;
      const predicate = item.p.value;
      const value = item.o.value;

      return { URI, name, predicate, value };
    });
  }

  async getWindowProps(): Promise<Space[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ex: <https://example.com/>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    SELECT ?inst ?p ?o 
    WHERE { 
        ?inst a ifc:IfcWindow .
        ?inst ?p ?o .
    } 
      
       `;

    const spaces = await lastValueFrom(this._comunica.selectQuery(query));
    return spaces.map((item: any) => {
      const URI = item.subclass.value;
      const name = item.inst.value;
      const predicate = item.p.value;
      const value = item.o.value;

      return { URI, name, predicate, value };
    });
  }

}
