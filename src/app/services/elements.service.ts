import { Injectable } from '@angular/core';
// import { ComunicaService } from 'ngx-comunica';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { Serialization, Source, SourceType, UpdateResult } from 'src/app/3rdparty/comunica/models';
import { WKTObject, WKTObjectOptions } from 'ngx-ifc-viewer';
import { lastValueFrom } from 'rxjs';
import { Properties } from '../models';
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

 
  async getProps(): Promise<Properties[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ex: <https://example.com/>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    SELECT ?inst ?p ?o ?ifcType
    WHERE { 
        ?inst a ?ifcType .
        ?inst ?p ?o .
    } LIMIT 1000
      
       `;

    const spaces = await lastValueFrom(this._comunica.selectQuery(query));
    return spaces.map((item: any) => {
      const ifcType = item.ifcType.value;
      const instance = item.inst.value;
      const property = item.p.value;
      const value = item.o.value;

      return { ifcType, instance, property, value };
    });
  }
}
