import { Injectable } from '@angular/core';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { lastValueFrom } from 'rxjs';
import { Properties } from '../models';
import { UtilsService } from './utils.service';

@Injectable({
  providedIn: 'root',
})
export class ElementsService {
  public queryResult?: any;
  public queryComplete: boolean = false;

  constructor(
    private _comunica: ComunicaService,
  ) {}

  async getTypes(): Promise<Properties[]> {
    const query = `PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>

    SELECT DISTINCT ?type
    WHERE { 
        ?s a ?type
    }
    `;

    const spaces = await lastValueFrom(this._comunica.selectQuery(query));
    return spaces.map((item: any) => {
      const typeWithURI = item.type.value;

      var type = typeWithURI.split('#').pop();

      const checked: boolean = false;

      return { type, typeWithURI, checked };
    });
  }

 
  async getProps(TypeName: any, NameWithURI: any): Promise<Properties[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ex: <https://example.com/>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    SELECT DISTINCT  ?pSet ?Property ?Value
    WHERE { 
      ?inst a <${NameWithURI}> .
      ?inst ?Property ?Value .
      ?Property <https://example.com/belongsToPset> ?pSet
    } ORDER BY ?pSet 
    `;

    const spaces = await lastValueFrom(this._comunica.selectQuery(query));
    return spaces.map((item: any) => {
      // const instanceWithURI = item.inst.value;
      const propertyWithURI = item.Property.value;
      const value = item.Value.value;
      const pSetWithURI = item.pSet.value;

      var pSet = pSetWithURI.split('/').pop();
      var property = propertyWithURI.split('/').pop();

      return { pSet, property, value, TypeName };
    });
  }
}
