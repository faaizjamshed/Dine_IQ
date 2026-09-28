import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import pandas as pd
from app.daily_forecasts import DATA, bp, select_forecast
from flask import Flask
from scripts.ml.daily_forecast import panel, rollout


class DailyForecastTests(unittest.TestCase):
    def test_calendar_gap_is_zero_before_lagging(self):
        grid = panel(pd.DataFrame({'entity':['a','a'],'day':['2026-01-01','2026-01-03'],'units':[2,4]}))
        self.assertEqual(grid.a.tolist(), [2,0,4])

    def test_rollout_uses_own_predictions_and_monday_zero(self):
        inputs=[]
        def predict(x):
            inputs.append(x.copy())
            return x.lag_1.to_numpy()+1
        history=pd.DataFrame({'a':np.arange(28)},index=pd.date_range('2026-01-05',periods=28))
        result=rollout(SimpleNamespace(predict=predict),history,14)
        self.assertEqual([r['prediction'] for r in result],list(range(28,42)))
        self.assertEqual(inputs[0].dow.tolist(),[0])
        self.assertEqual(result[7]['baseline'],result[0]['baseline'])
        self.assertEqual(history.iloc[-1,0],27)

    def test_persisted_scope_horizons_and_invalid_filters(self):
        data=json.loads(DATA.read_text())
        for level,count in [('item',200),('category',15),('location',25)]:
            for horizon in (7,14,28):
                selected=select_forecast(data,{'level':level,'horizon':str(horizon)})
                self.assertEqual(len(selected['entities']),count)
                self.assertEqual(len(selected['forecasts']),horizon)
                self.assertEqual(len(selected['history']),28)
                self.assertTrue(all(r['day']>selected['training_end'] and r['prediction']>=0 for r in selected['forecasts']))
        for args in ({'level':'bad'},{'horizon':'8'},{'horizon':'abc'},{'entity':'missing'},{'city':'Karachi'}):
            with self.assertRaises(ValueError): select_forecast(data,args)

    def test_corrupt_or_missing_artifact_fails_closed(self):
        app=Flask(__name__);app.register_blueprint(bp)
        with patch.object(Path,'read_bytes',return_value=b'{}'):
            self.assertEqual(app.test_client().get('/api/ml/daily-forecast').status_code,503)

    def test_api_contract_and_bad_filter(self):
        app=Flask(__name__);app.register_blueprint(bp)
        client=app.test_client()
        self.assertEqual(client.get('/api/ml/daily-forecast?level=category&horizon=14').status_code,200)
        self.assertEqual(client.get('/api/ml/daily-forecast?horizon=0').status_code,400)


if __name__=='__main__': unittest.main()
